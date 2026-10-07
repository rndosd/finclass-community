import React from "react";
import ErrorState from "./ErrorState";

export default class PageErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() { return { hasError: true }; }

  componentDidCatch(error) {
    const errorType = ["ChunkLoadError", "TypeError", "SyntaxError"].includes(error?.name) ? error.name : "Error";
    console.error("[PageErrorBoundary] page-load-failed", {
      area: this.props.resetKey === "/bank" ? "bank" : "page",
      errorType,
      occurredAt: new Date().toISOString(),
    });
  }

  componentDidUpdate(previousProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <ErrorState title="페이지를 불러오지 못했습니다."
        description="화면 오류가 발생했습니다. 다시 시도해 보고, 계속 실패하면 연결 상태를 확인한 뒤 페이지를 다시 불러와 주세요."
        onRetry={() => this.setState({ hasError: false })}
        onReload={() => window.location.reload()} />
    );
  }
}
