// src/components/ui/ImageLightbox.jsx

import React, { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";

const ImageLightbox = ({ images = [], initialIndex = 0, onClose }) => {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [scale, setScale] = useState(1);

    const handlePrevious = () => {
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
        setScale(1);
    };

    const handleNext = () => {
        setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
        setScale(1);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowLeft") {
                setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
                setScale(1);
            }
            if (e.key === "ArrowRight") {
                setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
                setScale(1);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "hidden";

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "unset";
        };
    }, [images.length, onClose]);

    const handleZoomIn = () => {
        setScale((prev) => Math.min(prev + 0.25, 3));
    };

    const handleZoomOut = () => {
        setScale((prev) => Math.max(prev - 0.25, 0.5));
    };

    if (images.length === 0) return null;

    const currentImage = images[currentIndex];

    return (
        <div
            className="fixed inset-0 z-[99999] bg-black bg-opacity-90 flex items-center justify-center"
            onClick={onClose}
        >
            {/* 닫기 버튼 */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors z-10"
            >
                <X className="w-8 h-8" />
            </button>

            {/* 줌 컨트롤 */}
            <div className="absolute top-4 left-4 flex gap-2 z-10">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleZoomIn();
                    }}
                    className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white p-2 rounded transition-colors"
                >
                    <ZoomIn className="w-5 h-5" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleZoomOut();
                    }}
                    className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white p-2 rounded transition-colors"
                >
                    <ZoomOut className="w-5 h-5" />
                </button>
                <span className="bg-white bg-opacity-20 text-white px-3 py-2 rounded text-sm">
                    {Math.round(scale * 100)}%
                </span>
            </div>

            {/* 이미지 카운터 */}
            {images.length > 1 && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white bg-opacity-20 text-white px-4 py-2 rounded text-sm z-10">
                    {currentIndex + 1} / {images.length}
                </div>
            )}

            {/* 이전/다음 버튼 */}
            {images.length > 1 && (
                <>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handlePrevious();
                        }}
                        className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-20 hover:bg-opacity-30 text-white p-3 rounded-full transition-colors z-10"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleNext();
                        }}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white bg-opacity-20 hover:bg-opacity-30 text-white p-3 rounded-full transition-colors z-10"
                    >
                        <ChevronRight className="w-6 h-6" />
                    </button>
                </>
            )}

            {/* 이미지 */}
            <div
                className="flex items-center justify-center p-4"
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    src={currentImage}
                    alt={`Attachment ${currentIndex + 1}`}
                    className="max-w-[85vw] max-h-[85vh] w-auto h-auto object-contain transition-transform duration-200"
                    style={{
                        transform: `scale(${scale})`,
                        transformOrigin: "center",
                    }}
                />
            </div>
        </div>
    );
};

export default ImageLightbox;
