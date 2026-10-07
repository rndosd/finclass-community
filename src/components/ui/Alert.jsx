// src/components/ui/Alert.jsx
import React from 'react';
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XMarkIcon } from '@heroicons/react/24/solid'; // 아이콘 크기를 위해 solid 사용 또는 outline 사용 후 크기 조절

export default function Alert({ type = 'info', message, onClose, className = '' }) {
    const baseStyle = "p-4 rounded-xl flex items-start gap-3";
    let typeStyle = "";
    let IconComponent;

    switch (type) {
        case 'success':
            typeStyle = "bg-emerald-50 border border-emerald-200 text-emerald-800";
            IconComponent = CheckCircleIcon;
            break;
        case 'error':
            typeStyle = "bg-rose-50 border border-rose-200 text-rose-800";
            IconComponent = XCircleIcon;
            break;
        case 'warning':
            typeStyle = "bg-amber-50 border border-amber-200 text-amber-900";
            IconComponent = ExclamationTriangleIcon;
            break;
        case 'info':
        default:
            typeStyle = "bg-blue-50 border border-blue-200 text-blue-800";
            IconComponent = InformationCircleIcon;
            break;
    }

    return (
        <div className={`${baseStyle} ${typeStyle} ${className}`} role="alert">
            <div className="flex-shrink-0">
                <IconComponent className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
                <p className="text-sm leading-[22px]">{message}</p>
            </div>
            {onClose && (
                <div className="flex-shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className={`-mt-2 h-11 w-11 shrink-0 items-center justify-center rounded-xl inline-flex focus:outline-none focus:ring-2 focus:ring-offset-2 
                        ${type === 'success' ? 'hover:bg-green-100 focus:ring-offset-green-50 focus:ring-green-600' : ''}
                        ${type === 'error' ? 'hover:bg-red-100 focus:ring-offset-red-50 focus:ring-red-600' : ''}
                        ${type === 'warning' ? 'hover:bg-yellow-100 focus:ring-offset-yellow-50 focus:ring-yellow-600' : ''}
                        ${type === 'info' ? 'hover:bg-blue-100 focus:ring-offset-blue-50 focus:ring-blue-600' : ''}
            `}
                        aria-label="알림 닫기"
                    >
                        <span className="sr-only">알림 닫기</span>
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>
            )}
        </div>
    );
}
