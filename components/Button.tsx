"use client";

import { ButtonHTMLAttributes, useState, MouseEvent } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

/** 애플 스타일 버튼 + ripple + scale(0.97) click */
export function Button({ variant = "primary", className = "", onClick, children, ...rest }: Props) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now() + Math.random();
    setRipples((r) => [...r, { id, x, y }]);
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 600);
    onClick?.(e);
  };

  const base =
    "relative overflow-hidden inline-flex items-center justify-center gap-2 text-[20px] font-medium px-8 py-4 rounded-2xl transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed select-none";

  const variants = {
    primary:
      "bg-apple-blue text-white shadow-card hover:shadow-cardHover hover:brightness-105",
    secondary:
      "bg-apple-silver text-neutral-900 hover:bg-apple-silver2",
    ghost:
      "bg-transparent text-apple-blue hover:bg-apple-silver",
  };

  return (
    <button
      {...rest}
      onClick={handleClick}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute rounded-full bg-white/40 animate-ripple"
          style={{
            left: r.x,
            top: r.y,
            width: 10,
            height: 10,
            marginLeft: -5,
            marginTop: -5,
          }}
        />
      ))}
    </button>
  );
}
