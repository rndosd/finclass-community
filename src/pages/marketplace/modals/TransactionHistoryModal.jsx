import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
// src/pages/marketplace/modals/TransactionHistoryModal.jsx

import React, { useState, useEffect } from 'react';
import { Modal, Button, Badge, DataTable, SurfaceLoader, TableSkeleton } from '../../../components/ui';
import { History, User, Package, Calendar, DollarSign, TrendingUp } from 'lucide-react';
import { useUser } from '../../../contexts/UserContext';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../firebase';

const TransactionHistoryModal = ({
    isOpen,
    onClose,
    currencyName,
    isTeacher = false,
    title = "최근 거래 기록",
    formatWholeNumber,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    const { classId } = useUser();
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState({
        totalTransactions: 0,
        totalVolume: 0,
        averagePrice: 0,
        todayTransactions: 0
    });
    const hasTransactions = transactions.length > 0;

    const toWholePrice = (value) => Math.max(0, Math.trunc(Number(value || 0)));

    // 실제 거래 데이터 로드
    useEffect(() => {
        if (!(isOpen && isTeacher && classId)) return;

        let cancelled = false;

        const loadTransactionData = async () => {
            setLoading(true);
            try {
                const transactionQuery = query(
                    collection(db, 'classes', classId, 'marketplace_transactions'),
                    where('status', '==', 'completed'),
                    orderBy('completedAt', 'desc'),
                    limit(100)
                );

                const snapshot = await getDocs(transactionQuery);
                const transactionList = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                if (cancelled) return;

                setTransactions(transactionList);

                const totalVolume = transactionList.reduce((sum, t) => sum + toWholePrice(t.price), 0);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const todayTransactions = transactionList.filter(t => {
                    const transactionDate = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
                    return transactionDate >= today;
                }).length;

                setStats({
                    totalTransactions: transactionList.length,
                    totalVolume,
                    averagePrice: transactionList.length > 0 ? Math.round(totalVolume / transactionList.length) : 0,
                    todayTransactions
                });
            } catch (error) {
                if (!cancelled) {
                    console.error('거래 기록 로드 실패:', error);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        loadTransactionData();

        return () => {
            cancelled = true;
        };
    }, [isOpen, isTeacher, classId]);

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

    const getTransactionTypeColor = (type) => {
        switch (type) {
            case 'purchase':
                return 'bg-gradient-to-r from-blue-500 to-blue-600 text-white';
            case 'auction_settlement':
                return 'bg-gradient-to-r from-indigo-500 to-blue-600 text-white';
            default:
                return 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white';
        }
    };

    const getTransactionTypeLabel = (type) => {
        switch (type) {
            case 'purchase':
                return '바로구매';
            case 'auction_settlement':
                return '경매낙찰';
            default:
                return '거래';
        }
    };

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="xl"
            title={
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
                        <History className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xl font-bold">{title}</span>
                </div>
            }
        >
            <div className="space-y-6 p-1">
                {/* 통계 카드들 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-100">
                        <div className="flex items-center gap-2 mb-2">
                            <Package size={16} className="text-blue-600" />
                            <span className="text-sm font-semibold text-blue-700">최근 거래</span>
                        </div>
                        <div className="text-2xl font-bold text-blue-700">
                            {stats.totalTransactions}건
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-100">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp size={16} className="text-blue-600" />
                            <span className="text-sm font-semibold text-blue-700">최근 거래액</span>
                        </div>
                        <div className="text-2xl font-bold text-blue-700">
                            {formatWholeNumber ? formatWholeNumber(stats.totalVolume) : stats.totalVolume.toLocaleString()} {currencyName}
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-100">
                        <div className="flex items-center gap-2 mb-2">
                            <DollarSign size={16} className="text-indigo-600" />
                            <span className="text-sm font-semibold text-indigo-700">평균 가격</span>
                        </div>
                        <div className="text-2xl font-bold text-indigo-700">
                            {formatWholeNumber ? formatWholeNumber(stats.averagePrice) : formatDisplayMoney(stats.averagePrice)} {currencyName}
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-50 to-blue-50 border-2 border-cyan-100">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar size={16} className="text-cyan-600" />
                            <span className="text-sm font-semibold text-cyan-700">오늘 거래</span>
                        </div>
                        <div className="text-2xl font-bold text-cyan-700">
                            {stats.todayTransactions}건
                        </div>
                    </div>
                </div>

                {/* 거래 목록 */}
                <SurfaceLoader
                    loading={loading}
                    variant={hasTransactions ? "refreshing" : "surface-loading"}
                    preserveContent={hasTransactions}
                    skeleton={<TableSkeleton bare columns={6} rows={6} className="h-full min-h-full" />}
                    minHeightClassName="min-h-[320px]"
                >
                    <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
                        {transactions.length === 0 ? (
                            <div className="text-center py-12">
                                <div className="p-4 rounded-2xl bg-slate-100 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                                    <History className="w-8 h-8 text-slate-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-700 mb-2">
                                    거래 기록이 없습니다
                                </h3>
                                <p className="text-slate-500">
                                    아직 완료된 거래가 없습니다.
                                </p>
                            </div>
                        ) : (
                            <DataTable>
                                <DataTable.Header>
                                    <DataTable.Row interactive={false}>
                                        <DataTable.HeadCell>거래일시</DataTable.HeadCell>
                                        <DataTable.HeadCell>거래유형</DataTable.HeadCell>
                                        <DataTable.HeadCell>상품명</DataTable.HeadCell>
                                        <DataTable.HeadCell>판매자</DataTable.HeadCell>
                                        <DataTable.HeadCell>구매자</DataTable.HeadCell>
                                        <DataTable.HeadCell align="right">가격</DataTable.HeadCell>
                                    </DataTable.Row>
                                </DataTable.Header>
                                <DataTable.Body>
                                        {transactions.map((transaction, index) => (
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
                                                    <Badge
                                                        size="sm"
                                                        className={`${getTransactionTypeColor(transaction.type)} border-0 shadow-sm`}
                                                    >
                                                        {getTransactionTypeLabel(transaction.type)}
                                                    </Badge>
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
                                                            {transaction.sellerName || '—'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-2">
                                                        <User size={14} className="text-slate-400" />
                                                        <span className="text-sm text-slate-600">
                                                            {transaction.buyerName || '—'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <DollarSign size={14} className="text-blue-600" />
                                                        <span className="text-lg font-bold text-blue-600">
                                                            {formatWholeNumber ? formatWholeNumber(toWholePrice(transaction.price)) : formatDisplayMoney(toWholePrice(transaction.price))} {currencyName}
                                                        </span>
                                                    </div>
                                                </td>
                                            </DataTable.Row>
                                        ))}
                                </DataTable.Body>
                            </DataTable>
                        )}
                    </div>
                </SurfaceLoader>

                {/* 요약 정보 */}
                {transactions.length > 0 && (
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <TrendingUp size={16} className="text-blue-600" />
                                <span className="text-sm font-semibold text-blue-700">거래 요약</span>
                            </div>
                            <div className="text-sm text-blue-600">
                                최근 최대 100건 중 <span className="font-bold">{transactions.length}건</span>의 거래로
                                <span className="font-bold ml-1">{formatWholeNumber ? formatWholeNumber(stats.totalVolume) : stats.totalVolume.toLocaleString()} {currencyName}</span>이 거래되었습니다
                            </div>
                        </div>
                    </div>
                )}

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

export default TransactionHistoryModal;
