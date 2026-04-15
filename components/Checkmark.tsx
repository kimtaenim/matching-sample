"use client";

/** SVG 체크마크 드로잉 애니메이션 */
export function Checkmark({ size = 120 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className="block"
      aria-label="매칭 완료"
    >
      <circle
        cx="60"
        cy="60"
        r="54"
        fill="none"
        stroke="#007AFF"
        strokeWidth="6"
        strokeLinecap="round"
        className="animate-drawCircle"
        style={{
          strokeDasharray: 340,
          strokeDashoffset: 340,
          transformOrigin: "center",
        }}
      />
      <path
        d="M 38 62 L 54 78 L 84 46"
        fill="none"
        stroke="#007AFF"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-drawCheck"
        style={{ strokeDasharray: 90, strokeDashoffset: 90 }}
      />
    </svg>
  );
}
