// src/components/ui/Avatar.jsx
import React from 'react';

export default function Avatar({ src, alt = "User avatar", size = 'md', shape = 'circle', placeholderInitials = '', className = '' }) {
    const baseStyle = "inline-flex items-center justify-center bg-gray-200 text-gray-600 font-semibold object-cover";

    let sizeStyle = "";
    let textSizeStyle = "";
    switch (size) {
        case 'xs': sizeStyle = 'h-6 w-6'; textSizeStyle = 'text-xs'; break;
        case 'sm': sizeStyle = 'h-8 w-8'; textSizeStyle = 'text-sm'; break;
        case 'lg': sizeStyle = 'h-16 w-16'; textSizeStyle = 'text-2xl'; break;
        case 'xl': sizeStyle = 'h-24 w-24'; textSizeStyle = 'text-4xl'; break;
        case 'md': default: sizeStyle = 'h-10 w-10'; textSizeStyle = 'text-base'; break;
    }

    let shapeStyle = "";
    switch (shape) {
        case 'rounded': shapeStyle = 'rounded-md'; break;
        case 'square': shapeStyle = 'rounded-none'; break;
        case 'circle': default: shapeStyle = 'rounded-full'; break;
    }

    if (src) {
        return (
            <img
                className={`${baseStyle} ${sizeStyle} ${shapeStyle} ${className}`}
                src={src}
                alt={alt}
            />
        );
    }

    // src가 없을 경우 placeholderInitials 표시
    const initials = placeholderInitials || (alt ? alt.substring(0, 2).toUpperCase() : '??');

    return (
        <span className={`${baseStyle} ${sizeStyle} ${shapeStyle} ${textSizeStyle} ${className}`} title={alt}>
            {initials}
        </span>
    );
}