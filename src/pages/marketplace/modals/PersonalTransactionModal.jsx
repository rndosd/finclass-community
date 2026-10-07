import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
// src/pages/marketplace/modals/PersonalTransactionModal.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Badge, DataTable, SurfaceLoader, TableSkeleton } from '../../../components/ui';
import { History, ShoppingCart, DollarSign, User, Calendar, Package } from 'lucide-react';
import { useUser } from '../../../contexts/UserContext';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../firebase';

const PersonalTransactionModal = ({
    isOpen,
    onClose,
    currencyName,
    formatWholeNumber,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    const { userData, classId } = useUser();
    const [activeTab, setActiveTab] = useState('purchase');
    const [transactions, setTransactions] = useState({
        purchases: [],
        sales: []
    });
    const [loading, setLoading] = useState(false);

    const currentUserId = userData?.uid;
    const hasLoadedTransactions =
        transactions.purchases.length > 0 || transactions.sales.length > 0;

    const loadTransactionData = useCallback(async () => {
        if (!currentUserId || !classId) return;

        setLoading(true);
        try {
            // 구매 내역 조회
            const purchaseQuery = query(
                collection(db, 'classes', classId, 'marketplace_transactions'),
                where('buyerId', '==', currentUserId),
                where('status', '==', 'completed'),
                orderBy('completedAt', 'desc'),
                limit(100)
            );

            // 판매 내역 조회  
            const saleQuery = query(
                collection(db, 'classes', classId, 'marketplace_transactions'),
                where('sellerId', '==', currentUserId),
                where('status', '==', 'completed'),
                orderBy('completedAt', 'desc'),
                limit(100)
            );

            const [purchaseSnapshot, saleSnapshot] = await Promise.all([
                getDocs(purchaseQuery),
                getDocs(saleQuery)
            ]);

            const purchases = purchaseSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const sales = saleSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            setTransactions({ purchases, sales });
        } catch (error) {
            console.error('거래 기록 로드 실패:', error);
        } finally {
            setLoading(false);
        }
    }, [classId, currentUserId]);

    // 실제 거래 데이터 로드
    useEffect(() => {
        if (isOpen && currentUserId && classId) {
            loadTransactionData();
        }
    }, [isOpen, currentUserId, classId, loadTransactionData]);

    const formatDate = (date) => {
        if (!date) return '—';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const toWholePrice = (value) => Math.max(0, Math.trunc(Number(value || 0)));
    const currentData = activeTab === 'purchase' ? transactions.purchases : transactions.sales;
    const totalAmount = currentData.reduce((sum, transaction) => sum + toWholePrice(transaction.price), 0);

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="xl"
            title={
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600">
                        <History className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xl font-bold">나의 최근 거래 기록</span>
                </div>
            }
        >
            <div className="space-y-6 p-1">
                {/* 탭 네비게이션 */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-1">
                    <div className="flex gap-1">
                        <Button
                            onClick={() => setActiveTab('purchase')}
                            className={[
                                "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-all duration-300",
                                "font-semibold text-sm",
                                activeTab === 'purchase'
                                    ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg"
                                    : "text-slate-600 hover:bg-slate-100"
                            ].join(" ")}
                        >
                            <ShoppingCart size={16} />
                            구매 내역
                            <Badge size="sm" className="ml-1 bg-white/20 text-white border-0">
                                {transactions.purchases.length}
                            </Badge>
                        </Button>
                        <Button
                            onClick={() => setActiveTab('sale')}
                            className={[
                                "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-all duration-300",
                                "font-semibold text-sm",
                                activeTab === 'sale'
                                    ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg"
                                    : "text-slate-600 hover:bg-slate-100"
                            ].join(" ")}
                        >
                            <DollarSign size={16} />
                            판매 내역
                            <Badge size="sm" className="ml-1 bg-white/20 text-white border-0">
                                {transactions.sales.length}
                            </Badge>
                        </Button>
                    </div>
                </div>

                {/* 통계 요약 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-100">
                        <div className="flex items-center gap-2 mb-2">
                            <Package size={16} className="text-blue-600" />
                            <span className="text-sm font-semibold text-blue-700">최근 건수</span>
                        </div>
                        <div className="text-2xl font-bold text-blue-700">
                            {currentData.length}건
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-green-50 border-2 border-emerald-100">
                        <div className="flex items-center gap-2 mb-2">
                            <DollarSign size={16} className="text-emerald-600" />
                            <span className="text-sm font-semibold text-emerald-700">
                                총 {activeTab === 'purchase' ? '지출' : '수익'}
                            </span>
                        </div>
                        <div className={`text-2xl font-bold ${activeTab === 'purchase' ? 'text-red-600' : 'text-emerald-700'}`}>
                            {activeTab === 'purchase' ? '-' : '+'}{formatWholeNumber ? formatWholeNumber(totalAmount) : formatDisplayMoney(totalAmount)} {currencyName}
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-50 to-slate-100 border-2 border-slate-200">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar size={16} className="text-slate-600" />
                            <span className="text-sm font-semibold text-slate-700">평균 거래액</span>
                        </div>
                        <div className="text-2xl font-bold text-slate-700">
                            {currentData.length > 0
                                ? (formatWholeNumber
                                    ? formatWholeNumber(Math.round(totalAmount / currentData.length))
                                    : formatDisplayMoney(Math.round(totalAmount / currentData.length)))
                                : '0'
                            } {currencyName}
                        </div>
                    </div>
                </div>

                {/* 거래 목록 */}
                <SurfaceLoader
                    loading={loading}
                    variant={hasLoadedTransactions ? "refreshing" : "surface-loading"}
                    preserveContent={hasLoadedTransactions}
                    skeleton={<TableSkeleton bare columns={4} rows={6} className="h-full min-h-full" />}
                    minHeightClassName="min-h-[320px]"
                >
                    <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
                        {currentData.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="p-4 rounded-2xl bg-slate-100 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                                    {activeTab === 'purchase' ? (
                                        <ShoppingCart className="w-8 h-8 text-slate-400" />
                                    ) : (
                                        <DollarSign className="w-8 h-8 text-slate-400" />
                                    )}
                                </div>
                                <h3 className="text-lg font-semibold text-slate-700 mb-2">
                                    {activeTab === 'purchase' ? '구매' : '판매'} 기록이 없습니다
                                </h3>
                                <p className="text-slate-500">
                                    {activeTab === 'purchase'
                                        ? '아직 구매한 상품이 없습니다.'
                                        : '아직 판매한 상품이 없습니다.'
                                    }
                                </p>
                            </div>
                        ) : (
                            <DataTable>
                                <DataTable.Header>
                                    <DataTable.Row interactive={false}>
                                        <DataTable.HeadCell>거래일시</DataTable.HeadCell>
                                        <DataTable.HeadCell>상품명</DataTable.HeadCell>
                                        <DataTable.HeadCell>
                                            {activeTab === 'purchase' ? '판매자' : '구매자'}
                                        </DataTable.HeadCell>
                                        <DataTable.HeadCell align="right">가격</DataTable.HeadCell>
                                    </DataTable.Row>
                                </DataTable.Header>
                                <DataTable.Body>
                                        {currentData.map((transaction, index) => (
                                            <DataTable.Row key={transaction.id || index}>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar size={14} className="text-slate-400" />
                                                        <span className="text-sm text-slate-700">
                                                            {formatDate(transaction.completedAt || transaction.createdAt)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-2">
                                                        <Package size={14} className="text-slate-400" />
                                                        <span className="font-medium text-slate-800">
                                                            {transaction.itemTitle || transaction.title || '—'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-2">
                                                        <User size={14} className="text-slate-400" />
                                                        <span className="text-sm text-slate-600">
                                                            {activeTab === 'purchase'
                                                                ? (transaction.sellerName || '—')
                                                                : (transaction.buyerName || '—')
                                                            }
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5 text-right">
                                                    <span className={`text-lg font-bold ${activeTab === 'purchase' ? 'text-red-600' : 'text-emerald-600'
                                                        }`}>
                                                        {activeTab === 'purchase' ? '-' : '+'}
                                                        {formatWholeNumber ? formatWholeNumber(toWholePrice(transaction.price)) : formatDisplayMoney(toWholePrice(transaction.price))} {currencyName}
                                                    </span>
                                                </td>
                                            </DataTable.Row>
                                        ))}
                                </DataTable.Body>
                            </DataTable>
                        )}
                    </div>
                </SurfaceLoader>

                {/* 액션 버튼 */}
                <div className="flex justify-end pt-4 border-t border-slate-200">
                    <Button
                        onClick={onClose}
                        variant="outline"
                        
                        size="lg"
                    >
                        닫기
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default PersonalTransactionModal;
