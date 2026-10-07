"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { splitLayout, joinLayout, verifySplit } = require("../utils/realEstateStorageSchema");
const { createCallableHarness } = require("./helpers/callableMemoryHarness");
const ROOT = "classes/c1/real_estate/";
const source = () => ({
    editorRevision: 4,
    constraints: { fixedSeats: { permanent: "tenant" }, avoidGroups: [], genderSeatPreferences: {}, genderShuffleMode: "ignore" },
    groups: [{ id: "g1", rows: 1, cols: 2, desks: [{
        id: "g1-0-0", permanentId: "permanent", number: 1, studentId: "tenant", studentName: "김가람", isActive: true, teamId: "team1",
        ownerId: "owner", ownerName: "이서준", price: 700, lastPurchasePrice: 1000,
        rentContractId: "rent-original", rentContractStatus: "active", rentTenantId: "tenant",
        rentPaidAmount: 120, rentPaidDays: 14, rentPaidUntil: "2026-10-07",
        rentDepositPaidAmount: 50, rentDepositReturnedAmount: 10, rentDepositDeductedAmount: 5,
        unknownFutureFinancialField: { preserve: true },
        buyerId: "buyer", contractState: { selectedAt: "2026-09-30", sellerSignatureImg: "synthetic-signature", sellerSigned: true },
    }, { id: "g1-0-1", permanentId: "hidden", number: 2, isActive: false, ownerId: null, rentPaidUntil: null, contractState: null }] }],
});
function seedSplit(layout = source()) {
    const split = splitLayout(layout);
    return Object.fromEntries([[`${ROOT}layout`, split.layout],
        ...[...split.properties].map(([id, p]) => [`${ROOT}properties/items/${id}`, p]),
        ...[...split.contracts].map(([id, c]) => [`${ROOT}contracts/records/${id}`, c])]);
}

test("split/rejoin preserves hidden desks, unknown fields, signatures, nulls and original rent IDs", () => {
    const data = source();const split = splitLayout(data);
    assert.equal(verifySplit(data, split).desks, 2);
    assert.deepEqual(joinLayout(split.layout, split.properties, split.contracts), { ...data, storageSchemaVersion: 3 });
    assert.equal(split.layout.groups[0].desks[0].ownerId, undefined);
    assert.equal(split.properties.get("g1-0-0").fields.rentPaidAmount, undefined);
    assert.equal(split.properties.get("g1-0-0").fields.contractState, undefined);
    assert.equal(split.contracts.get("rent-original").fields.rentPaidAmount, 120);
});
test("legacy rent with no contract ID stays intact instead of being assigned to a new contract", () => {
    const data = source();delete data.groups[0].desks[0].rentContractId;
    const split = splitLayout(data);assert.equal(split.contracts.size, 1);
    assert.equal(split.properties.get("g1-0-0").fields.rentPaidAmount, 120);verifySplit(data, split);
});
test("missing/duplicate desk IDs and reused rent IDs abort partitioning", () => {
    for (const kind of ["missing", "duplicate", "rent"]){const data=source();const desks=data.groups[0].desks;
        if(kind==="missing")delete desks[0].id;else if(kind==="duplicate")desks[1].id=desks[0].id;else desks[1].rentContractId=desks[0].rentContractId;
        assert.throws(()=>splitLayout(data));}
});
test("sale selection gets a deterministic ID; signing preserves it and a new selection changes it", () => {
    const data=source(),a=splitLayout(data);const first=a.properties.get("g1-0-0").saleContractId;
    data.groups[0].desks[0].contractState.buyerSignatureImg="another-synthetic-signature";
    const b=splitLayout(data,a.properties);assert.equal(b.properties.get("g1-0-0").saleContractId,first);
    data.groups[0].desks[0].buyerId="next-buyer";assert.notEqual(splitLayout(data,b.properties).properties.get("g1-0-0").saleContractId,first);
});
test("missing properties or contracts and crossed desk identities fail closed", () => {
    const s=splitLayout(source());assert.throws(()=>joinLayout(s.layout,new Map(),s.contracts));
    assert.throws(()=>joinLayout(s.layout,s.properties,new Map()));
    s.contracts.get("rent-original").deskId="different-desk";assert.throws(()=>joinLayout(s.layout,s.properties,s.contracts));
});
test("existing legacy transaction writes stay in the legacy document", async () => {
    const h=createCallableHarness({[`${ROOT}layout`]:source()});
    const repo=h.load("functions/utils/realEstateStorage.js");
    await h.db.runTransaction(async tx=>{await repo.readRealEstateLayout(h.db,h.db.doc(`${ROOT}layout`),tx);repo.stageRealEstateLayout(tx,h.db.doc(`${ROOT}layout`),{editorRevision:5});});
    assert.equal(h.writes.length,1);assert.equal(h.data.get(`${ROOT}layout`).editorRevision,5);
});
test("retried financial mutation commits contract and balance together without rewriting other properties", async () => {
    const h=createCallableHarness({...seedSplit(),"classes/c1/students/tenant":{assets:{cash:200}}},{retryTransaction:true});
    const repo=h.load("functions/utils/realEstateStorage.js");
    await repo.runRealEstateTransaction(h.db,async tx=>{const ref=h.db.doc(`${ROOT}layout`);const snap=await repo.readRealEstateLayout(h.db,ref,tx);
        const tenant=await tx.get(h.db.doc("classes/c1/students/tenant"));const data=snap.data();data.groups[0].desks[0].rentPaidAmount+=20;
        repo.stageRealEstateLayout(tx,ref,{groups:data.groups});tx.update(h.db.doc("classes/c1/students/tenant"),{"assets.cash":tenant.data().assets.cash-20});});
    assert.equal(h.data.get(`${ROOT}contracts/records/rent-original`).fields.rentPaidAmount,140);
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash,180);
    assert.equal(h.writes.some(w=>w.path===`${ROOT}layout`),false);
    assert.equal(h.writes.some(w=>w.path.includes("properties/items")),false);
});
test("a new seat atomically gets both its lean layout entry and property document", async () => {
    const h=createCallableHarness(seedSplit());const repo=h.load("functions/utils/realEstateStorage.js");
    await h.db.runTransaction(async tx=>{const ref=h.db.doc(`${ROOT}layout`),snap=await repo.readRealEstateLayout(h.db,ref,tx),data=snap.data();
        data.groups[0].desks.push({id:"new-seat",permanentId:"new-permanent",number:3,isActive:true,price:900,ownerId:null});repo.stageRealEstateLayout(tx,ref,data,{replace:true});});
    assert.equal(h.data.get(`${ROOT}layout`).groups[0].desks.length,3);
    assert.equal(h.data.get(`${ROOT}properties/items/new-seat`).fields.price,900);
});
test("clearing current sale/rent pointers retains old contract documents", async () => {
    const seed=seedSplit();const oldSaleId=seed[`${ROOT}properties/items/g1-0-0`].saleContractId;
    const h=createCallableHarness(seed),repo=h.load("functions/utils/realEstateStorage.js");
    await h.db.runTransaction(async tx=>{const ref=h.db.doc(`${ROOT}layout`),snap=await repo.readRealEstateLayout(h.db,ref,tx),data=snap.data(),desk=data.groups[0].desks[0];
        desk.contractState=null;desk.rentContractId=null;repo.stageRealEstateLayout(tx,ref,{groups:data.groups});});
    assert(h.data.has(`${ROOT}contracts/records/${oldSaleId}`));assert(h.data.has(`${ROOT}contracts/records/rent-original`));
});
test("removing a migrated desk or missing financial source aborts all staged money writes", async () => {
    for(const missing of [false,true]){const seed=seedSplit();if(missing)delete seed[`${ROOT}contracts/records/rent-original`];
        const h=createCallableHarness(seed),repo=h.load("functions/utils/realEstateStorage.js");
        await assert.rejects(h.db.runTransaction(async tx=>{const ref=h.db.doc(`${ROOT}layout`),snap=await repo.readRealEstateLayout(h.db,ref,tx),data=snap.data();
            data.groups[0].desks=[];repo.stageRealEstateLayout(tx,ref,{groups:data.groups});}));assert.equal(h.writes.length,0);}
});

test("real rent callable preserves balances, contract and one receipt under retry and duplicate requests", async () => {
    const data=source(),desk=data.groups[0].desks[0];
    Object.assign(desk,{weeklyRent:70,rentStartAt:"2026-09-01T00:00:00+09:00",rentLastDateAt:"2026-10-31T00:00:00+09:00",rentPaidDays:7,rentPaidAmount:70});
    const h=createCallableHarness({...seedSplit(data),"classes/c1":{planType:"FREE"},
        [`${ROOT}config`]:{enabled:true,rentTaxEnabled:false},
        "classes/c1/students/tenant":{name:"김가람",assets:{cash:1000}},
        "classes/c1/students/owner":{name:"이서준",assets:{cash:500}},
    },{retryTransaction:true});
    const api=h.load("functions/src/realestate.js");
    const request={auth:{uid:"tenant",token:{classId:"c1",role:"student"}},data:{classId:"c1",deskId:desk.id,days:7,clientRequestId:"rent-retry-001"}};
    await api.payRent(request);await api.payRent(request);
    assert.equal(h.data.get("classes/c1/students/tenant").assets.cash,930);
    assert.equal(h.data.get("classes/c1/students/owner").assets.cash,570);
    assert.equal(h.data.get(`${ROOT}contracts/records/rent-original`).fields.rentPaidAmount,140);
    assert.equal([...h.data.keys()].filter(k=>k.includes("rent_payments/records/")).length,1);
    assert.equal(h.data.get(`${ROOT}rent_payments/records/pay_rent-retry-001`).contractId,"rent-original");
});
test("real sale callable atomically transfers ownership, keeps the signed contract and denies a second debit", async () => {
    const data=source(),desk=data.groups[0].desks[0];
    Object.assign(desk,{tradeStatus:"contracting",isForSale:true,askingPrice:1100,contractState:{selectedAt:"2026-09-07",sellerSigned:true,buyerSigned:true,sellerSignatureImg:"synthetic-sale-signature"}});
    const records={...seedSplit(data),"classes/c1":{planType:"FREE"},[`${ROOT}config`]:{enabled:true,acquisitionTaxEnabled:false,capitalGainsTaxEnabled:false},
        "classes/c1/students/buyer":{name:"박하늘",assets:{cash:2000}},"classes/c1/students/owner":{name:"이서준",assets:{cash:500}}};
    const signedId=records[`${ROOT}properties/items/${desk.id}`].saleContractId;
    const h=createCallableHarness(records,{retryTransaction:true}),api=h.load("functions/src/realestate.js");
    const request={auth:{uid:"buyer",token:{classId:"c1",role:"student"}},data:{classId:"c1",deskId:desk.id,clientRequestId:"sale-retry-001"}};
    await api.executeRealEstateTransaction(request);
    await assert.rejects(api.executeRealEstateTransaction(request));
    assert.equal(h.data.get("classes/c1/students/buyer").assets.cash,900);
    assert.equal(h.data.get("classes/c1/students/owner").assets.cash,1600);
    assert.equal(h.data.get(`${ROOT}properties/items/${desk.id}`).fields.ownerId,"buyer");
    assert.equal(h.data.get(`${ROOT}contracts/records/${signedId}`).state.sellerSignatureImg,"synthetic-sale-signature");
    assert.equal([...h.data.keys()].filter(k=>k.includes("ledger/transactions/")).length,1);
});
test("late owner events reconcile current split source rather than overwrite assets with old event values", async () => {
    const data=source();data.groups[0].desks[0].ownerId="buyer";
    const h=createCallableHarness({...seedSplit(data),"classes/c1/students/owner":{assets:{realEstateValue:1000,realEstateCount:1,totalNetWorth:1500}},
        "classes/c1/students/buyer":{assets:{realEstateValue:0,realEstateCount:0,totalNetWorth:2000}}},{retryTransaction:true});
    const projection=h.load("functions/utils/realEstateAssetProjection.js");
    await projection.reconcileRealEstateAssets(h.db,"c1",["owner"]);await projection.reconcileRealEstateAssets(h.db,"c1",["owner"]);
    assert.equal(h.data.get("classes/c1/students/owner").assets.realEstateValue,0);
    assert.equal(h.data.get("classes/c1/students/owner").assets.totalNetWorth,500);
    assert.equal(h.data.get("classes/c1/students/buyer").assets.realEstateValue,1000);
    assert.equal(h.data.get("classes/c1/students/buyer").assets.totalNetWorth,3000);
});


test("operator migration is atomic, retryable and preserves ledger/deposit history", async () => {
    const h=createCallableHarness({['classes/c1/real_estate/layout']:source(),
        ['classes/c1/real_estate/layoutView']:{old:true}, ['classes/c1/real_estate/ledger/transactions/past']:{deskId:'absent-history',amount:55},
        ['classes/c1/real_estate/rent_deposits/records/dep1']:{amount:50}}, {retryTransaction:true});
    const migration=h.load('functions/utils/realEstateStorageMigration.js');
    const plan=await migration.planStorageMigration(h.db,'c1');
    await migration.applyStorageMigration(h.db,plan,'split-op');
    assert.equal(h.data.get(ROOT+'layout').storageSchemaVersion,3);
    assert.equal(h.data.has(ROOT+'layoutView'),false);
    assert.equal(h.data.get(ROOT+'ledger/transactions/past').deskId,'absent-history');
    assert.equal(h.data.get(ROOT+'rent_deposits/records/dep1').amount,50);
    assert.equal(h.data.get('classMaintenance/c1').active,false);
    const writes=h.writes.length;
    await migration.applyStorageMigration(h.db,plan,'split-op');
    assert.equal(h.writes.slice(writes).filter(w=>w.path.startsWith(ROOT)).length,0);
    assert.equal(h.data.get('realEstateStorageMigrations/c1/operations/split-op').source.groups[0].desks[0].rentContractId,'rent-original');
});
test("source drift or existing destination aborts split without partial finance writes", async () => {
    for(const collision of [false,true]) {
        const h=createCallableHarness({[ROOT+'layout']:source()}),migration=h.load('functions/utils/realEstateStorageMigration.js');
        const plan=await migration.planStorageMigration(h.db,'c1');
        if(collision)h.data.set(ROOT+'properties/items/unreviewed',{version:3});
        else h.data.get(ROOT+'layout').groups[0].desks[0].price+=1;
        await assert.rejects(migration.applyStorageMigration(h.db,plan,'failed-split'));
        assert.equal(h.data.get(ROOT+'layout').storageSchemaVersion,undefined);
        assert.equal(h.data.has('realEstateStorageMigrations/c1/operations/failed-split'),false);
        assert.equal(h.data.get('classMaintenance/c1').active,false);
    }
});
test("rollback rebuilds latest financial values rather than restoring pre-migration backup", async () => {
    const h=createCallableHarness({[ROOT+'layout']:source()});
    const migration=h.load('functions/utils/realEstateStorageMigration.js'),repo=h.load('functions/utils/realEstateStorage.js');
    await migration.applyStorageMigration(h.db,await migration.planStorageMigration(h.db,'c1'),'initial-split');
    await repo.runRealEstateTransaction(h.db,async tx=>{const ref=h.db.doc(ROOT+'layout'),snapshot=await repo.readRealEstateLayout(h.db,ref,tx),data=snapshot.data();
        data.groups[0].desks[0].lastPurchasePrice=1700; data.groups[0].desks[0].rentPaidAmount=333;
        repo.stageRealEstateLayout(tx,ref,{groups:data.groups});});
    await migration.applyStorageMigration(h.db,await migration.planStorageMigration(h.db,'c1',{rollback:true}),'latest-rollback');
    const restored=h.data.get(ROOT+'layout');assert.equal(restored.storageSchemaVersion,undefined);
    assert.equal(restored.groups[0].desks[0].lastPurchasePrice,1700);
    assert.equal(restored.groups[0].desks[0].rentPaidAmount,333);
    assert.equal(restored.groups[0].desks[0].contractState.sellerSignatureImg,'synthetic-signature');
    assert.equal(h.data.has(ROOT+'contracts/records/rent-original'),true);
});
test("maintenance freeze denies a transaction before changing money", async () => {
    const h=createCallableHarness({...seedSplit(),'classMaintenance/c1':{active:true}}),repo=h.load('functions/utils/realEstateStorage.js');
    await assert.rejects(repo.runRealEstateTransaction(h.db,async tx=>{await repo.readRealEstateLayout(h.db,h.db.doc(ROOT+'layout'),tx);}));
    assert.equal(h.writes.length,0);
});


const comparableLayout=async(h)=>{const repo=h.load('functions/utils/realEstateStorage.js');const data=(await repo.readRealEstateLayout(h.db,h.db.doc(ROOT+'layout'))).data();delete data.storageSchemaVersion;return data;};
const compareFinance=async(legacy,split)=>{
    const {fingerprint}=require('../utils/realEstateStorageSchema');
    assert.equal(fingerprint(await comparableLayout(legacy)),fingerprint(await comparableLayout(split)));
    const records=(h)=>[...h.data].filter(([path])=>!path.includes('/real_estate/layout')&&!path.includes('/properties/')&&!path.includes('/contracts/'));
    assert.equal(fingerprint(records(legacy)),fingerprint(records(split)));
};
test('rental first payment, duplicate receipt and deposit settlement match legacy accounting', async()=>{
    const data=source(),desk=data.groups[0].desks[0];
    Object.assign(desk,{weeklyRent:70,rentStartAt:'2026-09-08T00:00:00+09:00',rentLastDateAt:'2026-10-08T00:00:00+09:00',rentContractStatus:'pending_payment',
        rentPaidDays:0,rentPaidAmount:0,rentDepositAmount:50,rentDepositPaidAmount:0,rentDepositReturnedAmount:0,rentDepositDeductedAmount:0,rentDepositStatus:'pending'});
    const common={'classes/c1':{planType:'FREE'},[ROOT+'config']:{enabled:true,rentTaxEnabled:false},
        'classes/c1/students/tenant':{name:'김가람',assets:{cash:1000}},'classes/c1/students/owner':{name:'이서준',assets:{cash:500}},
        'classes/c1/students/teacher':{name:'교사',role:'teacher'}};
    const pair=[createCallableHarness({...common,[ROOT+'layout']:data},{retryTransaction:true}),createCallableHarness({...common,...seedSplit(data)},{retryTransaction:true})];
    for(const h of pair){const api=h.load('functions/src/realestate.js');const request={auth:{uid:'tenant',token:{classId:'c1',role:'student'}},data:{classId:'c1',deskId:desk.id,clientRequestId:'deposit-start-001'}};
        await api.payRentDeposit(request);await api.payRentDeposit(request);
        await api.settleRentDeposit({auth:{uid:'teacher',token:{role:'teacher',classId:'c1'}},data:{classId:'c1',deskId:desk.id,deductionAmount:0}});
        assert.equal(h.data.get('classes/c1/students/tenant').assets.cash,930);
        await assert.rejects(api.settleRentDeposit({auth:{uid:'teacher',token:{role:'teacher',classId:'c1'}},data:{classId:'c1',deskId:desk.id}}));}
    await compareFinance(...pair);
});
test('fund purchase and sale retain identical fund, treasury and audit values in split storage',async()=>{
    const data={groups:[{id:'g',desks:[{id:'d',permanentId:'p',number:1,price:700,isActive:true}]}]};
    const common={'classes/c1':{planType:'FREE'},[ROOT+'config']:{enabled:true,acquisitionTaxEnabled:false,capitalGainsTaxEnabled:false,officialPriceRatio:70},
        'classes/c1/students/teacher':{name:'교사',role:'teacher'},'classes/c1/classFunds/f1':{name:'연금',fundType:'pension',status:'active',cashBalance:2000},
        'classes/c1/dashboardSummary/taxSummary':{totalIncome:10000,totalExpense:0}};
    const pair=[createCallableHarness({...common,[ROOT+'layout']:data},{retryTransaction:true}),createCallableHarness({...common,...seedSplit(data)},{retryTransaction:true})];
    for(const h of pair){const api=h.load('functions/src/realestate.js');const request={auth:{uid:'teacher',token:{role:'teacher',classId:'c1'}},data:{classId:'c1',classFundId:'f1',deskId:'d',action:'purchase',clientRequestId:'fund-buy-001'}};
        await api.executeClassFundRealEstateTrade(request);
        await assert.rejects(api.executeClassFundRealEstateTrade(request));
        await api.executeClassFundRealEstateTrade({...request,data:{...request.data,action:'sell',clientRequestId:'fund-sell-001'}});
        assert.equal(h.data.get('classes/c1/classFunds/f1').cashBalance,2000);}
    await compareFinance(...pair);
});
test('auction cancellation keeps source and terminal auction state identical under retry',async()=>{
    const data=source();data.groups[0].desks[0].auctionSummary={auctionId:'a1',status:'active'};
    const common={'classes/c1':{planType:'FREE'},[ROOT+'config']:{enabled:true},'classes/c1/students/teacher':{name:'교사',role:'teacher'},
        'classes/c1/real_estate_auctions/a1':{deskId:'g1-0-0',source:'public',status:'active'}};
    const pair=[createCallableHarness({...common,[ROOT+'layout']:data},{retryTransaction:true}),createCallableHarness({...common,...seedSplit(data)},{retryTransaction:true})];
    for(const h of pair){const api=h.load('functions/src/realestateAuction.js');const request={auth:{uid:'teacher',token:{role:'teacher',classId:'c1'}},data:{classId:'c1',action:'cancel',payload:{auctionId:'a1'}}};
        await api.updateRealEstateAuctionState(request);await assert.rejects(api.updateRealEstateAuctionState(request));
        assert.equal(h.data.get('classes/c1/real_estate_auctions/a1').status,'cancelled');}
    await compareFinance(...pair);
});


test('rent-only read skips private sale signatures and forbids incomplete mutation snapshots',async()=>{
    const h=createCallableHarness(seedSplit()),repo=h.load('functions/utils/realEstateStorage.js');
    const result=await repo.readRealEstateLayout(h.db,h.db.doc(ROOT+'layout'),undefined,{includeSaleContracts:false});
    assert.equal(result.data().groups[0].desks[0].contractState,undefined);
    assert.equal(result.data().groups[0].desks[0].rentPaidAmount,120);
    assert.equal(h.reads.some(p=>p.includes('contracts/records/sale_contract_')),false);
    await assert.rejects(repo.runRealEstateTransaction(h.db,tx=>repo.readRealEstateLayout(h.db,h.db.doc(ROOT+'layout'),tx,{includeSaleContracts:false})));
});
test('cosmetic changes do not trigger financial asset or rent notification recomputation',()=>{
    const {assetFields,rentPropertyFields,activeSeats}=require('../utils/realEstateProjectionChanges');
    const before={fields:{ownerId:'o',price:100,weeklyRent:10,rentContractId:'r',ownerName:'old'}};
    const after={fields:{...before.fields,ownerName:'new',askingPrice:200}};
    assert.deepEqual(assetFields(before),assetFields(after));assert.deepEqual(rentPropertyFields(before),rentPropertyFields(after));
    after.fields.price=200;assert.notDeepEqual(assetFields(before),assetFields(after));assert.deepEqual(rentPropertyFields(before),rentPropertyFields(after));
    after.fields.ownerId='newOwner';assert.notDeepEqual(rentPropertyFields(before),rentPropertyFields(after));
    const layout=source(),changed=source();changed.groups[0].desks[0].studentName='새이름';
    assert.deepEqual(activeSeats(layout),activeSeats(changed));changed.groups[0].desks[0].isActive=false;assert.notDeepEqual(activeSeats(layout),activeSeats(changed));
});


test('SDK contention errors keep their original code for normal transaction retries',async()=>{
    const h=createCallableHarness(seedSplit()),repo=h.load('functions/utils/realEstateStorage.js');
    const aborted=Object.assign(new Error('synthetic contention'),{code:10});
    const original=h.db.collection;
    h.db.collection=(path)=>{const ref=original(path);if(path.endsWith('properties/items'))ref.get=async()=>{throw aborted;};return ref;};
    await assert.rejects(repo.readRealEstateLayout(h.db,h.db.doc(ROOT+'layout')),error=>error===aborted);
});
