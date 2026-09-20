import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { primary: "#fbbd14", ink: "#292824", cream: "#f7f6f2" },
    },
  },
  plugins: [],
} satisfies Config;
