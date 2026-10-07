import { useState } from "react";

import CertificateLicenseBack from "./CertificateLicenseBack";
import CertificateLicenseCard from "./CertificateLicenseCard";

export default function StudentCertificatePreviewCardV2(props) {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <button
      type="button"
      aria-label={`${props.item?.name || "자격증"} ${isFlipped ? "앞면 보기" : "뒷면 보기"}`}
      aria-pressed={isFlipped}
      onClick={() => setIsFlipped((current) => !current)}
      className="group block w-full rounded-[22px] text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200"
      style={{
        perspective: "1200px",
        aspectRatio: "1.586 / 1",
        minHeight: props.locked ? "240px" : undefined,
      }}
    >
      <div
        className="relative block h-full w-full transition-transform duration-700 motion-reduce:transition-none"
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        <div aria-hidden={isFlipped} className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
          <CertificateLicenseCard {...props} onOpen={undefined} actionHint="뒤집기" />
        </div>
        <div aria-hidden={!isFlipped} className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          <CertificateLicenseBack {...props} />
        </div>
      </div>
    </button>
  );
}
