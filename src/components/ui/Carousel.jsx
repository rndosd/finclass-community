import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

const Carousel = ({
    items = [],
    title = "",
    subtitle = "",
    renderItem,
    onItemSelect,
    showArrows = true,
    showIndicators = true,
    arrowStyle = "floating",
    indicatorStyle = "dots",
    className = "",
    autoPlay = false,
    autoPlayMs = 5000,
    enableSwipe = true,
    lockArrows = true,
    fixedHeight = null,
    // 🚀 추가 포인트: 그림자와 확대 효과를 위한 수직 여유 공간 (기본 60px)
    shadowBuffer = 60,
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const trackRef = useRef(null);
    const [containerHeight, setContainerHeight] = useState(null);

    // 1. 인덱스 보정
    useEffect(() => {
        if (currentIndex > items.length - 1) setCurrentIndex(0);
    }, [currentIndex, items.length]);

    // 2. 오토플레이
    useEffect(() => {
        if (!autoPlay || items.length <= 1) return;
        const id = setInterval(() => {
            setCurrentIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1));
        }, autoPlayMs);
        return () => clearInterval(id);
    }, [autoPlay, autoPlayMs, items.length]);

    // 3. 아이템 선택 알림
    useEffect(() => {
        if (onItemSelect && items[currentIndex]) {
            onItemSelect(items[currentIndex], currentIndex);
        }
    }, [currentIndex, onItemSelect, items]);

    // 4. 🚀 [핵심 수정] 높이 측정 및 여유 공간 확보
    useEffect(() => {
        if (!lockArrows || fixedHeight) {
            setContainerHeight(fixedHeight);
            return;
        }
        const measure = () => {
            if (!trackRef.current) return;
            const slides = trackRef.current.querySelectorAll("[data-slide]");
            let maxH = 0;
            slides.forEach((el) => (maxH = Math.max(maxH, el.offsetHeight || 0)));

            // 그림자 공간(shadowBuffer)을 더해 하단이 잘리는 것을 방지합니다.
            if (maxH > 0) setContainerHeight(maxH + shadowBuffer);
        };

        measure();
        const id = setTimeout(measure, 100); // 렌더링 완료 후 재측정
        window.addEventListener("resize", measure);

        const ro = new ResizeObserver(() => measure());
        if (trackRef.current) {
            trackRef.current.querySelectorAll("[data-slide]").forEach((el) => ro.observe(el));
        }
        return () => {
            clearTimeout(id);
            window.removeEventListener("resize", measure);
            ro.disconnect();
        };
    }, [items, lockArrows, fixedHeight, shadowBuffer]);

    // 이동 로직
    const goToNext = () => {
        if (isTransitioning || items.length <= 1) return;
        setIsTransitioning(true);
        setCurrentIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1));
        setTimeout(() => setIsTransitioning(false), 300); // 트랜지션 시간과 동기화
    };

    const goToPrevious = () => {
        if (isTransitioning || items.length <= 1) return;
        setIsTransitioning(true);
        setCurrentIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1));
        setTimeout(() => setIsTransitioning(false), 300);
    };

    const goToIndex = (index) => {
        if (isTransitioning || index === currentIndex) return;
        setIsTransitioning(true);
        setCurrentIndex(index);
        setTimeout(() => setIsTransitioning(false), 300);
    };

    // 스와이프 로직
    const [touchStart, setTouchStart] = useState(null);
    const [touchEnd, setTouchEnd] = useState(null);

    const handleTouchStart = (e) => { if (enableSwipe) setTouchStart(e.targetTouches[0].clientX); };
    const handleTouchMove = (e) => { if (enableSwipe) setTouchEnd(e.targetTouches[0].clientX); };
    const handleTouchEnd = () => {
        if (!enableSwipe || !touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        if (distance > 50) goToNext();
        else if (distance < -50) goToPrevious();
    };

    const trackStyle = useMemo(() => {
        const n = Math.max(1, items.length);
        return {
            transform: `translateX(-${currentIndex * (100 / n)}%)`,
            width: `${n * 100}%`,
            // 🚀 트랙 자체에는 높이를 주지 않고 자식들이 자연스럽게 차지하게 합니다.
        };
    }, [currentIndex, items.length]);

    if (!items || items.length === 0) return null;

    return (
        <div className={`w-full ${className} overflow-visible`}>
            {/* 헤더 섹션 */}
            {(title || subtitle) && (
                <div className="text-center mb-8">
                    {title && <h2 className="text-3xl font-black text-slate-800 mb-2">{title}</h2>}
                    {subtitle && <p className="text-slate-500 font-medium">{subtitle}</p>}
                </div>
            )}

            {/* 뷰포트 컨테이너 */}
            <div className="relative group overflow-visible">
                <div
                    className="overflow-x-hidden overflow-y-visible py-4" // 🚀 그림자가 퍼질 상하 여백
                    style={containerHeight ? { minHeight: containerHeight } : {}}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    {/* 이동 트랙 */}
                    <div
                        ref={trackRef}
                        className="flex transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) will-change-transform"
                        style={trackStyle}
                    >
                        {items.map((item, index) => (
                            <div
                                key={index}
                                className="w-full flex-shrink-0 px-4 overflow-visible"
                                data-slide
                                style={{ width: `${100 / items.length}%` }}
                            >
                                {renderItem?.(item, index, {
                                    isActive: index === currentIndex,
                                    goToNext, goToPrevious, goToIndex,
                                })}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 화살표 버튼 (디자인 개선) */}
                {showArrows && items.length > 1 && (
                    <>
                        <button
                            onClick={goToPrevious}
                            className="absolute top-[45%] left-2 -translate-y-1/2 z-20 bg-white/90 hover:bg-white p-3 rounded-full shadow-xl text-slate-700 transition-all hover:scale-110 active:scale-95 disabled:opacity-30"
                            aria-label="이전"
                        >
                            <ChevronLeftIcon className="h-6 w-6" />
                        </button>
                        <button
                            onClick={goToNext}
                            className="absolute top-[45%] right-2 -translate-y-1/2 z-20 bg-white/90 hover:bg-white p-3 rounded-full shadow-xl text-slate-700 transition-all hover:scale-110 active:scale-95 disabled:opacity-30"
                            aria-label="다음"
                        >
                            <ChevronRightIcon className="h-6 w-6" />
                        </button>
                    </>
                )}
            </div>

            {/* 하단 인디케이터 (번호/점 선택 가능) */}
            {showIndicators && items.length > 1 && (
                <div className="flex flex-col items-center mt-6 gap-3">
                    <div className="flex space-x-2">
                        {items.map((_, index) => (
                            <button
                                key={index}
                                onClick={() => goToIndex(index)}
                                className={`transition-all duration-300 ${index === currentIndex
                                        ? "w-8 h-2 bg-indigo-600 rounded-full"
                                        : "w-2 h-2 bg-slate-300 hover:bg-slate-400 rounded-full"
                                    }`}
                            />
                        ))}
                    </div>
                    <span className="text-[10px] font-black text-slate-400 tracking-tighter">
                        {currentIndex + 1} / {items.length}
                    </span>
                </div>
            )}
        </div>
    );
};

export default Carousel;
