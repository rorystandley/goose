import { useState } from "react";
import { Pause, Play } from "lucide-react";

/**
 * F-14A plan view, wings at 20° sweep. Proportions and panel positions
 * referenced against the US Army FM 44-80 three-view (public domain):
 * https://commons.wikimedia.org/wiki/File:Grumman_F-14_Tomcat.png
 * Local coordinates preserve the approximately equal span and overall length.
 */
export function Aircraft() {
  const [paused, setPaused] = useState(false);
  return (
    <div
      className="aircraft-display"
      data-motion={paused ? "paused" : "playing"}
    >
      <svg
        className="aircraft"
        viewBox="0 0 520 320"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="grid"
            width="26"
            height="26"
            patternUnits="userSpaceOnUse"
          >
            <path d="M26 0H0V26" stroke="currentColor" opacity=".1" />
          </pattern>
        </defs>
        <rect width="520" height="320" fill="url(#grid)" />
        <g stroke="currentColor">
          <circle cx="260" cy="158" r="130" opacity=".16" />
          <circle cx="260" cy="158" r="92" opacity=".15" />
          <path d="M260 8V312M105 158H415" strokeDasharray="4 7" opacity=".3" />
          <g className="aircraft-plan">
            <g
              transform="translate(260 25) scale(1.05)"
              strokeWidth="1.05"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              {/* Separate movable wings: long, shallow-swept leading edges and nearly straight trailing edges. */}
              {[-1, 1].map((side) => (
                <g key={`wing-${side}`} transform={`scale(${side} 1)`}>
                  <g className="aircraft-wing">
                    <path
                      d="M35 136L116 165Q121 167 122 172L124 185L31 181L28 154Z"
                      fill="currentColor"
                      fillOpacity=".045"
                    />
                    <path
                      d="M38 141L117 169L120 180M34 169L120 178M38 174L120 181M51 172L50 182M79 175L78 183M105 178L105 184"
                      opacity=".6"
                    />
                  </g>
                  {/* Tailplanes remain fixed while the main wings sweep. */}
                  <path
                    d="M29 195L63 236L66 242L61 249L35 244L27 227Z"
                    fill="currentColor"
                    fillOpacity=".06"
                  />
                  <path d="M32 201L59 237L61 248M59 237L65 241" opacity=".55" />
                </g>
              ))}
              {/* Long radome, narrow forebody, fixed wing gloves and broad central tunnel. */}
              <path
                d="M0 0C-4 12-9 31-10 49L-11 78L-21 78L-24 98L-35 119L-38 138L-31 158L-29 218L-25 231L-10 231L-8 240L-4 240L-4 251L4 251L4 240L8 240L10 231L25 231L29 218L31 158L38 138L35 119L24 98L21 78L11 78L10 49C9 31 4 12 0 0Z"
                fill="currentColor"
                fillOpacity=".055"
              />
              <path
                d="M-5 17H5M-8 32H8M-10 77L-7 97L-6 145H6L7 97L10 77M-5 153H5L4 181H-4ZM-4 184H4V217H-4ZM-8 223H8L4 240H-4Z"
                opacity=".65"
              />
              {/* Tandem pilot/RIO canopy, with a distinct windscreen and rear canopy frame. */}
              <path
                d="M0 23C-5 24-6 30-6 38L-6 65Q-5 71 0 73Q5 71 6 65L6 38C6 30 5 24 0 23Z"
                fill="currentColor"
                fillOpacity=".12"
              />
              <path
                d="M-5 33Q0 29 5 33M-6 39H6M-6 51H6M-5 66Q0 69 5 66M-2 41V48M2 41V48M-2 55V63M2 55V63"
                opacity=".7"
              />
              {[-1, 1].map((side) => (
                <g key={`engine-${side}`} transform={`scale(${side} 1)`}>
                  {/* Rectangular intake shoulders flow into two widely separated engine nacelles. */}
                  <path d="M12 80L21 80L27 120L29 157L27 222L10 222L10 151Z" />
                  <path
                    d="M13 86L21 86L24 110L13 110Z"
                    fill="currentColor"
                    fillOpacity=".15"
                  />
                  <path
                    d="M12 116L34 117M11 125L36 125M11 139L38 139M11 151L31 151M12 158L27 158M12 182L27 182M12 205L27 205"
                    opacity=".5"
                  />
                  <path
                    d="M23 98L34 124L36 136L29 156M31 139Q23 143 29 154"
                    opacity=".65"
                  />
                  {/* Nozzles flank the aft boat-tail; they do not merge into a single exhaust. */}
                  <path
                    d="M10 222L27 222L25 235Q18 238 11 235Z"
                    fill="currentColor"
                    fillOpacity=".12"
                  />
                  <path
                    d="M11 226H26M11 231H25M14 223V235M18 223V236M22 223V235"
                    opacity=".6"
                  />
                  {/* Near-vertical twin fins shown in orthographic projection, atop the nacelles. */}
                  <path
                    d="M18 179L20 179L23 216L26 240L21 237L17 211Z"
                    fill="currentColor"
                    fillOpacity=".13"
                  />
                  <path d="M20 184L20 211L24 234" opacity=".65" />
                </g>
              ))}
              <path d="M0 78V139M0 185V246" opacity=".3" />
            </g>
          </g>
          <g className="aircraft-plan-labels">
            <g opacity=".4" strokeWidth=".75">
              <path d="M45 73H222L253 87M302 175L338 135H477M283 247L332 269H445M240 269L209 297H76" />
              <circle cx="253" cy="87" r="2" />
              <circle cx="302" cy="175" r="2" />
              <circle cx="283" cy="247" r="2" />
              <circle cx="240" cy="269" r="2" />
            </g>
            <g
              fill="currentColor"
              stroke="none"
              fontFamily="monospace"
              fontSize="8"
              letterSpacing=".5"
              opacity=".7"
            >
              <text x="45" y="65">
                TANDEM COCKPIT / RIO
              </text>
              <text x="344" y="127">
                VARIABLE SWEEP / 20–68°
              </text>
              <text x="350" y="261">
                TWIN TAILS
              </text>
              <text x="76" y="310">
                TWIN ENGINE NACELLES
              </text>
            </g>
          </g>
          {/* A separate elevation drawing gives the roll a real side silhouette. */}
          <g className="aircraft-profile">
            <g
              transform="translate(128 130) scale(1.05)"
              strokeWidth="1.05"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <path
                d="M0 35Q10 29 25 26L34 24Q42 12 52 12Q65 10 77 19L87 23L129 22L165 20L181 17L220-15L237-15L232-9L225 18L247 21L251 25L246 29L249 33L236 36L235 40L220 42L212 39L181 40L172 44L167 39L150 39L144 37L101 36L85 40L51 40L40 42L23 41Q9 39 0 35Z"
                fill="currentColor"
                fillOpacity=".055"
              />
              {/* Radome break and two-seat bubble canopy. */}
              <path
                d="M25 26L23 41M34 24Q42 12 52 12Q65 10 77 19L85 24Z"
                fill="currentColor"
                fillOpacity=".12"
              />
              <path
                d="M49 13L46 24M63 14L61 24M38 27L86 27M42 29V35H50V29M58 29V35H67V29"
                opacity=".7"
              />
              {/* Intake ramp, wing glove and the shallow side projection of the main wing. */}
              <path d="M82 27L101 24L100 36L84 39ZM89 28L98 27L97 34L89 35ZM103 27L147 19L180 22L153 28Z" />
              <path
                d="M105 31L161 31L182 28L222 28M116 31V37M143 31V38M170 30V39M194 29V39M212 29V39"
                opacity=".55"
              />
              {/* Tall swept fin, engine exhaust and all-moving stabilizer. */}
              <path d="M181 17L220-15H237L232-9H223L202 19ZM222-10L205 18M226-9L217 19" />
              <path
                d="M167 31L237 25L249 28L192 35ZM227 21L244 23L244 33L228 36ZM232 23V34M237 23V34M241 24V33"
                fill="currentColor"
                fillOpacity=".07"
              />
              <path d="M32 37L78 37M89 40L169 39M173 40L211 38" opacity=".45" />
            </g>
          </g>
          <g className="aircraft-profile-labels">
            <g strokeWidth=".75" opacity=".4">
              <path d="M88 100H169L185 147M359 114L392 88H455M353 163L393 211H455M166 192H325" />
              <circle cx="185" cy="147" r="2" />
              <circle cx="359" cy="114" r="2" />
              <circle cx="353" cy="163" r="2" />
            </g>
            <g
              fill="currentColor"
              stroke="none"
              fontFamily="monospace"
              fontSize="8"
              letterSpacing=".5"
              opacity=".7"
            >
              <text x="88" y="92">
                PILOT + RIO
              </text>
              <text x="393" y="80">
                SWEPT FIN
              </text>
              <text x="397" y="223">
                AFTERBURNER
              </text>
              <text x="177" y="208">
                F-14A / SIDE ELEVATION
              </text>
            </g>
          </g>
        </g>
      </svg>
      <button
        className="aircraft-motion-toggle"
        onClick={() => setPaused((value) => !value)}
        aria-label={
          paused ? "Resume aircraft animation" : "Pause aircraft animation"
        }
      >
        {paused ? <Play size={11} /> : <Pause size={11} />}
        <span>{paused ? "Resume motion" : "Pause motion"}</span>
      </button>
    </div>
  );
}
