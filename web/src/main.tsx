import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "./config";
import { App } from "./App";
import { LangProvider } from "./i18n";
import "./styles.css";

const queryClient = new QueryClient();

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { err: e.message };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error(e, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, color: "#f3e6d4", fontFamily: "serif" }}>
          <p>Error / 页面出错：{this.state.err}</p>
          <button onClick={() => location.reload()}>Reload / 刷新</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <LangProvider>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </WagmiProvider>
      </LangProvider>
    </Boundary>
  </StrictMode>,
);
