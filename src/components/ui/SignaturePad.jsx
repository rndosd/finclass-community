import React, { useRef, useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

const SignaturePad = ({ onSign, isLocked, onEnd }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSigned, setHasSigned] = useState(false); // 서명 여부 체크

    // 캔버스 초기화
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();

            // 🔥 CSS 크기와 동일하게 설정 (dpr 제거)
            canvas.width = rect.width;
            canvas.height = rect.height;

            const ctx = canvas.getContext('2d');
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#000000';
        }
    }, []);

    // 좌표 구하기
    const getCoordinates = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // 🔥 CSS 크기와 캔버스 크기 비율 계산
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        if (e.touches && e.touches.length > 0) {
            return {
                offsetX: (e.touches[0].clientX - rect.left) * scaleX,
                offsetY: (e.touches[0].clientY - rect.top) * scaleY
            };
        }

        return {
            offsetX: (e.clientX - rect.left) * scaleX,
            offsetY: (e.clientY - rect.top) * scaleY
        };
    };

    const startDrawing = (e) => {
        if (isLocked) return;

        // 스크롤 방지 (터치 시)
        if (e.type === 'touchstart') document.body.style.overflow = 'hidden';

        const { offsetX, offsetY } = getCoordinates(e);
        const ctx = canvasRef.current.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY);
        setIsDrawing(true);

        // ✅ [수정] 점만 찍어도 서명으로 인정
        if (!hasSigned) {
            setHasSigned(true);
            if (onSign) onSign(true);
        }
    };

    const draw = (e) => {
        if (!isDrawing || isLocked) return;
        const { offsetX, offsetY } = getCoordinates(e);
        const ctx = canvasRef.current.getContext('2d');
        ctx.lineTo(offsetX, offsetY);
        ctx.stroke();
    };

    const stopDrawing = () => {
        if (isLocked) return;
        // 스크롤 복구
        document.body.style.overflow = '';

        if (isDrawing) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.closePath();
            setIsDrawing(false);

            // ✅ [핵심] 서명이 끝나면 이미지 데이터를 부모에게 전달
            if (hasSigned && onEnd && canvasRef.current) {
                const dataUrl = canvasRef.current.toDataURL("image/png");
                onEnd(dataUrl);
            }
        }
    };

    const clearSignature = () => {
        if (isLocked) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        setHasSigned(false);
        if (onSign) onSign(false); // 서명 취소 알림
        if (onEnd) onEnd(null);    // 데이터 초기화
    };

    return (
        <div className="relative group w-full h-full bg-white rounded-lg overflow-hidden">
            <canvas
                ref={canvasRef}
                className={`w-full h-full touch-none ${isLocked ? 'cursor-not-allowed bg-slate-50' : 'cursor-crosshair bg-white'}`}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
            />

            {/* 지우기 버튼 */}
            {!isLocked && hasSigned && (
                <button
                    onClick={clearSignature}
                    className="absolute top-2 right-2 p-1.5 bg-white border border-slate-200 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-all shadow-sm z-10"
                    title="다시 쓰기"
                >
                    <RotateCcw size={14} />
                </button>
            )}

            {/* 안내 문구 (서명하면 사라짐) */}
            {!hasSigned && !isLocked && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-300 text-sm font-sans select-none">
                    여기에 서명하세요
                </div>
            )}
        </div>
    );
};

export default SignaturePad;