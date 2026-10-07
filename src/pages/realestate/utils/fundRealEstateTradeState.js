export const getFundRealEstateTradeLockReason = (desk = {}) => {
  if (desk?.isActive === false) {
    return '비활성 좌석은 기금으로 거래할 수 없습니다.';
  }
  if (desk?.auctionSummary?.auctionId || desk?.foreclosureInfo?.auctionId) {
    return '진행 중인 경매가 있는 좌석은 기금으로 거래할 수 없습니다.';
  }
  if (String(desk?.tradeStatus || '') === 'contracting') {
    return '진행 중인 매매 계약이 있는 좌석은 기금으로 거래할 수 없습니다.';
  }
  return '';
};
