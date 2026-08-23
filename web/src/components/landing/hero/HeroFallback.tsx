/**
 * Non-WebGL fallback for the hero.
 *
 * Not a placeholder image and not an apology — the same composition rendered
 * as inline SVG: fragments arranged around a semantic event, joined by
 * relationship lines that draw themselves in. Anyone who lands here sees the
 * product's thesis, just without the camera move.
 */
export function HeroFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
      <svg viewBox="0 0 900 560" className="h-full w-full max-w-5xl opacity-90" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="hf-core" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#A5F5EA" />
            <stop offset="45%" stopColor="#19D6C4" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#19D6C4" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hf-edge" x1="0" x2="1">
            <stop offset="0%" stopColor="#19D6C4" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#19D6C4" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* relationship lines, drawn from each fragment toward the event */}
        <g stroke="url(#hf-edge)" strokeWidth="1" fill="none">
          {[
            "M212,196 L432,272", "M690,232 L468,272", "M600,132 L462,258",
            "M256,406 L436,292", "M636,414 L466,290", "M450,88 L450,240",
          ].map((d, i) => (
            <path key={i} d={d}>
              <animate
                attributeName="stroke-dasharray"
                from="0 400"
                to="400 0"
                dur="1.6s"
                begin={`${i * 0.12}s`}
                fill="freeze"
              />
            </path>
          ))}
        </g>
        <path d="M212,196 L600,132" stroke="#7A6DC9" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="4 4" fill="none" />

        {/* video frame */}
        <g transform="translate(212 196) rotate(-4)">
          <rect x="-84" y="-48" width="168" height="96" fill="#101822" stroke="#3D4658" />
          <rect x="-84" y="-48" width="3" height="96" fill="#4C9BE8" />
          <rect x="-26" y="-20" width="58" height="40" fill="#19D6C4" fillOpacity="0.09" stroke="#19D6C4" strokeOpacity="0.8" />
          <g stroke="#C2CAD6" strokeOpacity="0.3">
            <rect x="-62" y="-14" width="30" height="28" fill="none" />
            <rect x="38" y="-14" width="30" height="28" fill="none" />
          </g>
        </g>

        {/* document */}
        <g transform="translate(690 232) rotate(3)">
          <rect x="-52" y="-68" width="104" height="136" fill="#0F131A" stroke="#3D4658" />
          <rect x="-52" y="-68" width="3" height="136" fill="#D98E6A" />
          <g fill="#C2CAD6" fillOpacity="0.22">
            {[-48, -38, -28, -18].map((y) => (
              <rect key={y} x="-38" y={y} width="76" height="3" />
            ))}
            {[16, 26, 36].map((y) => (
              <rect key={y} x="-38" y={y} width="70" height="3" />
            ))}
          </g>
          <rect x="-42" y="-8" width="84" height="18" fill="#D98E6A" fillOpacity="0.14" />
          <rect x="-42" y="-8" width="2" height="18" fill="#D98E6A" />
        </g>

        {/* image region */}
        <g transform="translate(600 132) rotate(-6)">
          <rect x="-54" y="-40" width="108" height="80" fill="#141A24" stroke="#3D4658" />
          <rect x="-54" y="-40" width="3" height="80" fill="#9488DD" />
          <ellipse cx="4" cy="10" rx="30" ry="13" fill="none" stroke="#9488DD" strokeOpacity="0.8" />
        </g>

        {/* audio ribbon */}
        <g transform="translate(256 406)">
          {Array.from({ length: 46 }).map((_, i) => {
            const u = i / 45;
            const burst =
              Math.exp(-Math.pow((u - 0.28) / 0.2, 2)) + Math.exp(-Math.pow((u - 0.73) / 0.16, 2)) * 0.82;
            const h = Math.max(1.5, burst * (0.6 + 0.4 * Math.abs(Math.sin(u * Math.PI * 12))) * 34);
            return <rect key={i} x={-92 + i * 4} y={-h / 2} width="2" height={h} fill="#19D6C4" fillOpacity="0.6" />;
          })}
        </g>

        {/* quiet data nodes */}
        {[
          [450, 88, 5, "#4C9BE8"],
          [636, 414, 6, "#D98E6A"],
          [180, 300, 4, "#19D6C4"],
          [742, 330, 4, "#19D6C4"],
        ].map(([cx, cy, r, fill], i) => (
          <circle key={i} cx={cx as number} cy={cy as number} r={r as number} fill={fill as string} fillOpacity="0.85" />
        ))}

        {/* the semantic event */}
        <g transform="translate(450 272)">
          <circle r="86" fill="url(#hf-core)" />
          <g stroke="#5EEBDC" strokeOpacity="0.55" fill="#0A5C55" fillOpacity="0.4">
            <polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" />
            <polygon points="0,-24 21,-12 21,12 0,24 -21,12 -21,-12" fill="none" strokeOpacity="0.3" />
          </g>
          <circle r="8" fill="#A5F5EA" />
        </g>
      </svg>
    </div>
  );
}
