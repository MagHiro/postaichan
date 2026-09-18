import nextConfig from "eslint-config-next/core-web-vitals";

export default [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "tsconfig.tsbuildinfo"],
    rules: {
      // Data-fetching effects are intentional in these client workspaces.
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-img-element": "off",
      "@next/next/no-location-assign-relative-destination": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
];
