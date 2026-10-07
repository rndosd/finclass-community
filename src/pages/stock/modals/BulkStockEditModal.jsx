// src/pages/stock/modals/BulkStockEditModal.jsx

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
    Alert,
    Button,
    EmptyState,
    InputField,
    Modal,
    SurfaceLoader,
    TableSkeleton,
} from "../../../components/ui";
import { Save, RefreshCw, Download, Upload, CheckCircle, PlusCircle } from "lucide-react";
import { db } from "../../../firebase";
import { doc, writeBatch, collection, getDocs } from "firebase/firestore";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import * as XLSX from 'xlsx';
import {
    getXlsxImportErrorMessage,
    parseFirstXlsxWorksheet,
    validateXlsxImportFile,
    XLSX_IMPORT_ACCEPT,
} from "../../../utils/safeXlsxImport";

const BATCH_WRITE_LIMIT = 450;

const normalizeEditableInfo = (info) => ({
    title: String(info?.title || ''),
    content: String(info?.content || ''),
});

const BulkStockEditModal = ({
    isOpen,
    onClose,
    onOpenRegistration,
    allStocksByCategory,
    ...modalProps
}) => {
    const { classId, userData } = useUser();
    const { showFeedback } = useFeedback();
    const queryClient = useQueryClient();
    const fileInputRef = useRef(null);
    const originalEditDataRef = useRef({});

    const [editData, setEditData] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);
    const [isLoadingData, setIsLoadingData] = useState(false);
    const [currentCategoryFilter, setCurrentCategoryFilter] = useState('');

    const normalizeStockSymbol = useCallback(
        (value) => String(value || "").trim().toUpperCase(),
        [],
    );

    // 모든 주식을 평탄화
    const allStocksFlat = useMemo(() => {
        const flatList = [];
        Object.entries(allStocksByCategory).forEach(([categoryName, stocks]) => {
            if (!Array.isArray(stocks)) return;
            stocks.forEach(stock => {
                const symbol = normalizeStockSymbol(stock?.ticker || stock?.symbol);
                if (!symbol) return;
                flatList.push({
                    ...stock,
                    symbol,
                    _categoryName: categoryName
                });
            });
        });
        return flatList;
    }, [allStocksByCategory, normalizeStockSymbol]);

    // Firebase에서 기존 데이터 로드
    const fetchExistingStockInfo = useCallback(async () => {
        if (!classId) return;

        setIsLoadingData(true);
        try {
            const querySnapshot = await getDocs(collection(db, "classes", classId, "stockInfo"));
            const existingData = {};

            querySnapshot.forEach((doc) => {
                existingData[doc.id] = doc.data();
            });

            const initialEditData = {};
            allStocksFlat.forEach(stock => {
                const savedInfo = existingData[stock.symbol];
                initialEditData[stock.symbol] = normalizeEditableInfo(savedInfo);
            });

            originalEditDataRef.current = initialEditData;
            setEditData(initialEditData);
        } catch (error) {
            console.error("기존 주식 정보 로드 실패:", error);
            showFeedback("기존 정보를 불러오는데 실패했습니다.", "error");
        } finally {
            setIsLoadingData(false);
        }
    }, [classId, allStocksFlat, showFeedback]);

    useEffect(() => {
        if (isOpen) {
            fetchExistingStockInfo();
            setIsSaved(false);
        }
    }, [isOpen, fetchExistingStockInfo]);

    // 입력 핸들러
    const handleInputChange = useCallback((ticker, field, value) => {
        setIsSaved(false);
        setEditData(prev => ({
            ...prev,
            [ticker]: {
                ...prev[ticker],
                [field]: value
            }
        }));
    }, []);

    // 엑셀 내보내기
    const handleExportExcel = () => {
        try {
            const excelData = allStocksFlat.map(stock => ({
                '티커': stock.symbol,
                '종목명': stock.companyName,
                '카테고리': stock._categoryName,
                '제목': editData[stock.symbol]?.title || '',
                '내용': editData[stock.symbol]?.content || '',
            }));

            const ws = XLSX.utils.json_to_sheet(excelData);

            ws['!cols'] = [
                { wch: 10 },
                { wch: 20 },
                { wch: 15 },
                { wch: 30 },
                { wch: 50 },
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '주식정보');

            XLSX.writeFile(wb, `주식정보_${new Date().toISOString().slice(0, 10)}.xlsx`);

            showFeedback("엑셀 파일이 다운로드되었습니다.", "success");
        } catch (error) {
            console.error("엑셀 내보내기 실패:", error);
            showFeedback("엑셀 내보내기에 실패했습니다.", "error");
        }
    };

    // 엑셀 가져오기
    const handleImportExcel = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            validateXlsxImportFile(file);
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const { rows: jsonData } = parseFirstXlsxWorksheet(
                        event.target.result,
                        { file, sheetToJsonOptions: {} },
                    );

                    const newEditData = { ...editData };
                    let importCount = 0;

                    jsonData.forEach(row => {
                        const ticker = row['티커'];
                        const normalizedTicker = normalizeStockSymbol(ticker);
                        if (normalizedTicker && newEditData[normalizedTicker] !== undefined) {
                            newEditData[normalizedTicker] = {
                                title: row['제목'] || '',
                                content: row['내용'] || '',
                            };
                            importCount++;
                        }
                    });

                    setEditData(newEditData);
                    setIsSaved(false);
                    showFeedback(`${importCount}개 종목 정보를 불러왔습니다. '일괄 저장'을 눌러 저장하세요.`, "success");
                } catch (error) {
                    console.error("엑셀 가져오기 실패:", error);
                    showFeedback(
                        getXlsxImportErrorMessage(error, "엑셀 파일 읽기에 실패했습니다."),
                        "error",
                    );
                } finally {
                    if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                    }
                }
            };

            reader.readAsArrayBuffer(file);
        } catch (error) {
            console.error("엑셀 가져오기 실패:", error);
            showFeedback(
                getXlsxImportErrorMessage(error, "엑셀 파일 읽기에 실패했습니다."),
                "error",
            );
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    // 일괄 저장 핸들러
    const handleSaveAll = async () => {
        if (!classId || !userData?.uid) {
            showFeedback("학급 정보가 없습니다.", "error");
            return;
        }

        try {
            setIsSaving(true);
            const timestamp = new Date();
            const updatedBy = userData?.uid;
            const updatedByName = userData?.displayName || userData?.email || "Unknown";

            const changedStocks = allStocksFlat.filter((stock) => {
                const currentData = normalizeEditableInfo(editData[stock.symbol]);
                const originalData = normalizeEditableInfo(originalEditDataRef.current[stock.symbol]);
                return (
                    currentData.title !== originalData.title ||
                    currentData.content !== originalData.content
                );
            });

            const writeCount = changedStocks.length;

            if (writeCount === 0) {
                showFeedback("변경된 데이터가 없습니다.", "info");
                return;
            }

            for (let index = 0; index < changedStocks.length; index += BATCH_WRITE_LIMIT) {
                const batch = writeBatch(db);
                const chunk = changedStocks.slice(index, index + BATCH_WRITE_LIMIT);

                chunk.forEach((stock) => {
                    const data = normalizeEditableInfo(editData[stock.symbol]);
                    const docRef = doc(db, "classes", classId, "stockInfo", stock.symbol);
                    const payload = {
                        symbol: stock.symbol,
                        title: data.title,
                        content: data.content,
                        lastUpdated: timestamp,
                        updatedBy,
                        updatedByName,
                    };
                    batch.set(docRef, payload, { merge: true });
                });

                await batch.commit();
            }

            await queryClient.invalidateQueries({ queryKey: ["stockInfo", classId] });
            originalEditDataRef.current = Object.fromEntries(
                allStocksFlat.map((stock) => [stock.symbol, normalizeEditableInfo(editData[stock.symbol])])
            );

            showFeedback(`총 ${writeCount}개 변경 종목 정보를 저장했습니다.`, "success");
            setIsSaved(true);

            setTimeout(() => setIsSaved(false), 3000);

        } catch (error) {
            console.error("일괄 저장 실패:", {
                code: error?.code,
                message: error?.message,
                error,
            });
            showFeedback("저장 중 오류가 발생했습니다.", "error");
        } finally {
            setIsSaving(false);
        }
    };

    const filteredStocks = currentCategoryFilter
        ? allStocksFlat.filter(stock => stock._categoryName === currentCategoryFilter)
        : allStocksFlat;
    const hasFilteredStocks = filteredStocks.length > 0;

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} title="주식 정보 일괄 편집" onClose={onClose} size="7xl" {...modalProps}>
            <div className="space-y-4">
                <Alert
                    type="info"
                    message="엑셀 다운로드 후 내용을 수정하고 다시 업로드하면 목록에 자동 입력됩니다. 마지막에 반드시 '일괄 저장'을 눌러야 반영됩니다."
                />

                <div className="flex flex-col sm:flex-row justify-between items-center pb-3 border-b gap-4 sm:gap-0">
                    {/* 왼쪽 컨트롤 그룹 */}
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select
                            value={currentCategoryFilter}
                            onChange={(e) => setCurrentCategoryFilter(e.target.value)}
                            className="p-2 border rounded-xl text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500/20 outline-none"
                        >
                            <option value="">전체 카테고리 ({allStocksFlat.length})</option>
                            {Object.keys(allStocksByCategory).map(cat => (
                                <option key={cat} value={cat}>{cat} ({allStocksByCategory[cat].length})</option>
                            ))}
                        </select>

                        <Button
                            onClick={fetchExistingStockInfo}
                            kind="ghost"
                            size="xs"
                            icon={RefreshCw}
                            title="데이터 새로고침"
                        />
                    </div>

                    {/* 오른쪽 버튼 그룹 */}
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <Button
                            onClick={onOpenRegistration}
                            tone="blue"
                            kind="outline"
                            size="sm"
                            icon={PlusCircle}
                        >
                            신규 종목 등록
                        </Button>
                        <Button onClick={handleExportExcel} tone="slate" kind="outline" size="sm" icon={Download}>
                            양식 다운로드
                        </Button>
                        <input type="file" accept={XLSX_IMPORT_ACCEPT} onChange={handleImportExcel} ref={fileInputRef} className="hidden" />
                        <Button onClick={() => fileInputRef.current.click()} tone="blue" kind="outline" size="sm" icon={Upload}>
                            엑셀 업로드
                        </Button>

                        <div className="w-px h-6 bg-gray-300 mx-2 hidden sm:block"></div>

                        <Button
                            onClick={handleSaveAll}
                            tone={isSaved ? "green" : "indigo"}
                            kind="solid"
                            icon={isSaved ? CheckCircle : Save}
                            disabled={isSaving || isLoadingData}
                            isLoading={isSaving}
                            loadingText="저장 중..."
                            className={`transition-all duration-300  ${isSaved ? 'ring-2 ring-green-200' : ''}`}
                        >
                            {isSaved ? "저장 완료!" : "일괄 저장"}
                        </Button>

                        <Button onClick={onClose} tone="slate" kind="outline" size="sm">
                            닫기
                        </Button>
                    </div>
                </div>

                <SurfaceLoader
                    loading={isLoadingData}
                    variant={hasFilteredStocks ? "refreshing" : "surface-loading"}
                    preserveContent={hasFilteredStocks}
                    skeleton={(
                        <TableSkeleton
                            bare
                            columns={3}
                            rows={6}
                            className="h-full min-h-full"
                        />
                    )}
                    minHeightClassName="min-h-[320px]"
                >
                    {hasFilteredStocks ? (
                    <div className="overflow-x-auto max-h-[60vh] border rounded-lg shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-[10%]">종목</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-[30%]">제목 (Title)</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-[60%]">내용 (Content)</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredStocks.map((stock) => (
                                    <tr key={stock.symbol} className="hover:bg-slate-50 transition-colors group">
                                        <td className="px-4 py-3 align-top">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-indigo-600">{stock.symbol}</span>
                                                <span className="text-xs text-gray-600 line-clamp-1">{stock.companyName}</span>
                                                <span className="text-[10px] text-gray-400 mt-1 bg-gray-100 px-1.5 py-0.5 rounded w-fit">
                                                    {stock._categoryName}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2 align-top">
                                            <InputField
                                                id={`title-${stock.symbol}`}
                                                placeholder="제목"
                                                value={editData[stock.symbol]?.title || ''}
                                                onChange={(e) => handleInputChange(stock.symbol, 'title', e.target.value)}
                                                className="!py-2 text-sm w-full border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                                            />
                                        </td>
                                        <td className="px-4 py-2 align-top">
                                            <textarea
                                                placeholder="내용"
                                                value={editData[stock.symbol]?.content || ''}
                                                onChange={(e) => handleInputChange(stock.symbol, 'content', e.target.value)}
                                                className="w-full min-h-[80px] p-2 text-sm border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-y transition-all"
                                                spellCheck="false"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    ) : (
                    <EmptyState
                        icon={RefreshCw}
                        title="현재 조건에 맞는 종목이 없습니다"
                        description="카테고리 필터를 변경하거나 전체 종목을 다시 확인해 보세요."
                        className="h-64"
                    />
                    )}
                </SurfaceLoader>
            </div>
        </Modal>
    );
};

export default BulkStockEditModal;
