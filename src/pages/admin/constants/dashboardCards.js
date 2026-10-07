import { Newspaper, Coins, ShieldCheck, Star, Heart } from 'lucide-react';

export const CARD_INFO = {
    news: {
        name: '주요 헤드라인',
        icon: <Newspaper />,
        description: '대시보드에 표시되는 뉴스'
    },
    asset: {
        name: '자산 카드',
        icon: <Coins />,
        description: '학생의 현금 및 주식 자산'
    },
    mission: {
        name: "과제 카드",
        icon: <ShieldCheck />,
        description: "진행 중인 과제와 과제"
    },
    credit: {
        name: '신용 카드',
        icon: <Star />,
        description: '신용 점수 및 등급 정보'
    },
    donation: {
        name: '기부 카드',
        icon: <Heart />,
        description: '기부 현황 및 기부하기'
    }
};

export const DEFAULT_DASHBOARD_SETTINGS = {
    showNewsCard: true,
    showAssetCard: true,
    showMissionCard: true,
    showCreditCard: true,
    showDonationCard: true,
    cardOrder: ['news', 'asset', 'mission', 'credit', 'donation']
};
