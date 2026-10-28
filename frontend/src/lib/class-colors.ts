export interface ClassColor {
  dot: string;
  text: string;
  button: string;
  solid: string;
  soft: string;
  ring: string;
}

export const CLASS_COLORS: ClassColor[] = [
  {
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    button:
      "border-emerald-400/30 bg-emerald-400/10 hover:border-emerald-300/60 hover:bg-emerald-400/15",
    solid: "bg-emerald-400 text-emerald-950",
    soft: "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
    ring: "focus-visible:ring-emerald-400/50",
  },
  {
    dot: "bg-sky-400",
    text: "text-sky-300",
    button: "border-sky-400/30 bg-sky-400/10 hover:border-sky-300/60 hover:bg-sky-400/15",
    solid: "bg-sky-400 text-sky-950",
    soft: "bg-sky-400/10 text-sky-300 border-sky-400/20",
    ring: "focus-visible:ring-sky-400/50",
  },
  {
    dot: "bg-violet-400",
    text: "text-violet-300",
    button:
      "border-violet-400/30 bg-violet-400/10 hover:border-violet-300/60 hover:bg-violet-400/15",
    solid: "bg-violet-400 text-violet-950",
    soft: "bg-violet-400/10 text-violet-300 border-violet-400/20",
    ring: "focus-visible:ring-violet-400/50",
  },
  {
    dot: "bg-amber-400",
    text: "text-amber-300",
    button:
      "border-amber-400/30 bg-amber-400/10 hover:border-amber-300/60 hover:bg-amber-400/15",
    solid: "bg-amber-400 text-amber-950",
    soft: "bg-amber-400/10 text-amber-300 border-amber-400/20",
    ring: "focus-visible:ring-amber-400/50",
  },
  {
    dot: "bg-rose-400",
    text: "text-rose-300",
    button: "border-rose-400/30 bg-rose-400/10 hover:border-rose-300/60 hover:bg-rose-400/15",
    solid: "bg-rose-400 text-rose-950",
    soft: "bg-rose-400/10 text-rose-300 border-rose-400/20",
    ring: "focus-visible:ring-rose-400/50",
  },
  {
    dot: "bg-teal-400",
    text: "text-teal-300",
    button: "border-teal-400/30 bg-teal-400/10 hover:border-teal-300/60 hover:bg-teal-400/15",
    solid: "bg-teal-400 text-teal-950",
    soft: "bg-teal-400/10 text-teal-300 border-teal-400/20",
    ring: "focus-visible:ring-teal-400/50",
  },
  {
    dot: "bg-orange-400",
    text: "text-orange-300",
    button:
      "border-orange-400/30 bg-orange-400/10 hover:border-orange-300/60 hover:bg-orange-400/15",
    solid: "bg-orange-400 text-orange-950",
    soft: "bg-orange-400/10 text-orange-300 border-orange-400/20",
    ring: "focus-visible:ring-orange-400/50",
  },
  {
    dot: "bg-indigo-400",
    text: "text-indigo-300",
    button:
      "border-indigo-400/30 bg-indigo-400/10 hover:border-indigo-300/60 hover:bg-indigo-400/15",
    solid: "bg-indigo-400 text-indigo-950",
    soft: "bg-indigo-400/10 text-indigo-300 border-indigo-400/20",
    ring: "focus-visible:ring-indigo-400/50",
  },
  {
    dot: "bg-lime-400",
    text: "text-lime-300",
    button: "border-lime-400/30 bg-lime-400/10 hover:border-lime-300/60 hover:bg-lime-400/15",
    solid: "bg-lime-400 text-lime-950",
    soft: "bg-lime-400/10 text-lime-300 border-lime-400/20",
    ring: "focus-visible:ring-lime-400/50",
  },
  {
    dot: "bg-fuchsia-400",
    text: "text-fuchsia-300",
    button:
      "border-fuchsia-400/30 bg-fuchsia-400/10 hover:border-fuchsia-300/60 hover:bg-fuchsia-400/15",
    solid: "bg-fuchsia-400 text-fuchsia-950",
    soft: "bg-fuchsia-400/10 text-fuchsia-300 border-fuchsia-400/20",
    ring: "focus-visible:ring-fuchsia-400/50",
  },
];

export function classColor(index: number): ClassColor {
  return CLASS_COLORS[index % CLASS_COLORS.length];
}
