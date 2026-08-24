import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to be taught this project's type scale.
 *
 * Its conflict resolution is name-driven: out of the box it knows `text-sm` is
 * a font size and `text-red-500` is a colour, but it has never heard of
 * `ui-2xs` or `display-lg`. An unrecognised `text-*` value is assumed to be a
 * colour, so `cn("text-ui-2xs", "text-ink-400")` looked like two colours and
 * the *size* was discarded — silently, and only at the call sites that merge a
 * colour in, which is why the damage was scattered rather than uniform. The
 * "Debug trace" toggle in the composer was rendering at the browser default
 * 16px next to 10px siblings for exactly this reason.
 *
 * Registering the scale restores the intended behaviour: size and colour are
 * different groups, and both survive the merge.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-xl",
            "display-lg",
            "display-md",
            "ui-2xs",
            "ui-xs",
            "ui-sm",
            "ui-base",
            "ui-lg",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
