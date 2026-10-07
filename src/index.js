// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import '@fontsource/gowun-batang/korean-400.css';
import '@fontsource/gowun-batang/korean-700.css';
import App from './App';
import { BrowserRouter } from "react-router-dom";
import reportWebVitals from './reportWebVitals';
import {
  buildCanonicalRedirectUrl,
  readCanonicalRedirectHosts,
} from "./config/canonicalHostRedirect";
import { publicOrigin } from "./config/publicOrigin";

const canonicalRedirectUrl = buildCanonicalRedirectUrl({
  canonicalOrigin: publicOrigin,
  currentHref: window.location.href,
  redirectHosts: readCanonicalRedirectHosts(),
});

if (canonicalRedirectUrl) {
  window.location.replace(canonicalRedirectUrl);
} else {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  const RootMode =
    process.env.NODE_ENV === "development" ? React.Fragment : React.StrictMode;

  root.render(
    <RootMode>
      {/* BrowserRouter만 남기고 나머지는 App.js 내부의 설정을 따릅니다 */}
      <BrowserRouter future={{ v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </RootMode>
  );

  reportWebVitals();
}
