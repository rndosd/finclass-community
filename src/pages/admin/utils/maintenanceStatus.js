export function getMaintenanceStatus(state, busy = false) {
  if (busy || (state.status === "running" && state.canRetry === false)) {
    return { title: "진행 중", message: "학생 계정과 연결된 기록을 정리하고 있습니다. 상태는 자동으로 갱신됩니다." };
  }
  if (state.status === "unknown") {
    return { title: "상태 확인 필요", message: "서버 응답을 확인하지 못했습니다. 상태를 확인하거나 같은 작업을 이어서 실행해 주세요." };
  }
  const phase = { students: "학생 계정·연결 기록 정리", collections: "학급 데이터 정리", summaries: "요약 정보 갱신", prepare: "정리 준비" }[state.phase];
  const reason = {
    precondition: "서버 데이터 또는 조회 설정을 확인해야 합니다.",
    connection: "서버 연결 또는 처리 시간이 초과되었습니다.",
    permission: "서버의 데이터 처리 권한을 확인해야 합니다.",
  }[state.failureReason];
  return {
    title: state.status === "failed" ? "정리 중단" : "이어서 처리 가능",
    message: `${phase ? `${phase} 단계에서 중단되었습니다. ` : "이전 정리 작업이 완료되지 않았습니다. "}${reason ? `${reason} ` : ""}‘이어서 정리하기’를 누르면 같은 작업을 재시도합니다. 반복해서 중단되면 관리자에게 문의해 주세요.`,
  };
}
