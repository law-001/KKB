import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f3ee",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 148,
            height: 116,
            transform: "rotate(-6deg)",
            border: "7px solid #2b2420",
            borderRadius: 12,
            color: "#2b2420",
            fontSize: 56,
            fontWeight: 700,
            fontFamily: "monospace",
            letterSpacing: "2px",
          }}
        >
          KKB
        </div>
      </div>
    ),
    { ...size },
  );
}
