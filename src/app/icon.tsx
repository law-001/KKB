import { ImageResponse } from "next/og";

// The rubber-stamp brand mark from DESIGN.md, rendered as the favicon —
// cream-filled outline box on a rounded cream backdrop so it reads on dark
// browser chrome, no rotation (reads cleanly at browser-tab scale).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 20,
            border: "3px solid #2b2420",
            borderRadius: 5,
            background: "#f7f3ee",
            color: "#2b2420",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "monospace",
            letterSpacing: "1px",
          }}
        >
          KKB
        </div>
      </div>
    ),
    { ...size },
  );
}
