"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createCallableHarness}=require("./helpers/callableMemoryHarness");
const {splitLayout,joinLayout}=require("../utils/realEstateStorageSchema");
const base="classes/c1/real_estate/";
const desk=()=>({id:"d1",permanentId:"p1",number:1,isActive:true,studentId:"tenant",studentName:"김가람",ownerId:"owner",weeklyRent:70,rentContractId:"old-rent",rentContractStatus:"active",rentTenantId:"tenant",rentStartAt:"2026-09-01",rentLastDateAt:"2026-09-07",rentPaidDays:7,rentPaidAmount:70,rentDepositAmount:0,rentDepositPaidAmount:0,rentDepositReturnedAmount:0,rentDepositDeductedAmount:0});
function setup(overrides={},split=true,extra=[]){
 const layout={groups:[{id:"g",desks:[{...desk(),...overrides},...extra]}]};
 let storage={[base+"layout"]:layout};
 if(split){const s=splitLayout(layout);storage=Object.fromEntries([[base+"layout",s.layout],...[...s.properties].map(([id,d])=>[base+"properties/items/"+id,d]),...[...s.contracts].map(([id,d])=>[base+"contracts/records/"+id,d])]);}
 const h=createCallableHarness({...storage,"classes/c1/students/teacher":{role:"teacher"},"classes/c1/students/tenant":{assets:{cash:1000}},"classes/c1/students/owner":{assets:{cash:2000}},[base+"config"]:{enabled:true},[base+"rent_payments/records/old-payment"]:{deskId:"d1",contractId:"old-rent",tenantId:"tenant",amount:70,paidDays:7}},{retryTransaction:true});
 const api=h.load("functions/src/realestate.js");
 const request={auth:{uid:"teacher",token:{classId:"c1",role:"teacher"}},data:{classId:"c1",deskIds:["d1"],weeklyRent:140,depositAmount:0,rentStartDateKey:"2026-09-08",rentLastDateKey:"2026-09-21"}};
 const read=()=>joinLayout(h.data.get(base+"layout"),new Map([...h.data].filter(([p])=>p.startsWith(base+"properties/items/")).map(([p,d])=>[p.split('/').at(-1),d])),new Map([...h.data].filter(([p])=>p.startsWith(base+"contracts/records/")).map(([p,d])=>[p.split('/').at(-1),d]))).groups[0].desks[0];
 return {h,api,request,read};
}
for(const split of [false,true])test(`fully paid expired contract can be replaced in ${split?'split':'legacy'} storage; retry preserves history and cash`,async()=>{
 const {h,api,request,read}=setup({},split);const old=structuredClone(h.data.get(base+"rent_payments/records/old-payment"));
 await api.updateRealEstateRentContractsBulk(request);const id=read().rentContractId;
 assert.notEqual(id,"old-rent");assert.equal(read().rentPaidAmount,0);assert.equal(read().rentContractStatus,"pending_payment");
 await api.updateRealEstateRentContractsBulk(request);assert.equal(read().rentContractId,id);
 assert.deepEqual(h.data.get(base+"rent_payments/records/old-payment"),old);assert.equal(h.data.get("classes/c1/students/tenant").assets.cash,1000);assert.equal(h.data.get("classes/c1/students/owner").assets.cash,2000);
 if(split)assert.equal(h.data.get(base+"contracts/records/old-rent").fields.rentPaidAmount,70);
});
for(const [name,overrides,message] of [
 ["ongoing",{rentLastDateAt:"2026-09-08"},/계약 종료 또는 재계약/],
 ["unpaid",{rentPaidAmount:60},/미납 임대료/],
 ["unreturned deposit",{rentDepositAmount:50,rentDepositPaidAmount:50},/보증금/],
 ["overpayment refund",{rentPaidAmount:80},/반환할 임대료/],
 ["no end date",{rentLastDateAt:null},/계약 종료 또는 재계약/],
])test(`${name} still blocks replacement without partial writes`,async()=>{
 const {h,api,request}=setup(overrides);await assert.rejects(api.updateRealEstateRentContractsBulk(request),message);assert.equal(h.writes.length,0);
});
test("new contract cannot overlap the expired period",async()=>{const {h,api,request}=setup();request.data.rentStartDateKey="2026-09-07";await assert.rejects(api.updateRealEstateRentContractsBulk(request),/마지막 거주일 이후/);assert.equal(h.writes.length,0);});
test("expired settled contract can be cleared without deleting payments",async()=>{const {h,api,request,read}=setup();request.data.weeklyRent=0;await api.updateRealEstateRentContractsBulk(request);assert.equal(read().rentContractId,null);assert.ok(h.data.has(base+"rent_payments/records/old-payment"));});
test("mixed bulk request is atomic when one seat is ongoing",async()=>{const second={...desk(),id:"d2",permanentId:"p2",studentId:"other",rentTenantId:"other",rentContractId:"other-rent",rentLastDateAt:"2026-09-15"};const {h,api,request}=setup({},true,[second]);request.data.deskIds.push("d2");await assert.rejects(api.updateRealEstateRentContractsBulk(request),/계약 종료 또는 재계약/);assert.equal(h.writes.length,0);});
test("students cannot replace contracts through the teacher bulk endpoint",async()=>{const {api,request}=setup();request.auth={uid:"tenant",token:{role:"student",classId:"c1"}};await assert.rejects(api.updateRealEstateRentContractsBulk(request),/권한/);});
