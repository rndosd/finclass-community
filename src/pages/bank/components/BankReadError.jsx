import ErrorState from "../../../components/ui/ErrorState";

export default function BankReadError({ onRetry }) {
  return (
    <ErrorState title="은행 정보를 불러오지 못했습니다."
      description="예금·대출 내역이나 은행 설정을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요."
      onRetry={onRetry}>
      <p className="text-sm text-slate-600">기존 내역은 그대로 유지됩니다. 정보를 다시 확인한 후 은행을 이용할 수 있어요.</p>
    </ErrorState>
  );
}
