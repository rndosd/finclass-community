const config = {
  style: { postcssOptions: { plugins: [require("tailwindcss"), require("autoprefixer")] } },
  devServer: { headers: { "Cross-Origin-Opener-Policy": "same-origin-allow-popups" } },
  webpack: {
    configure(webpackConfig) {
      for (const minimizer of webpackConfig.optimization?.minimizer || []) {
        if (minimizer?.constructor?.name === "TerserPlugin") minimizer.options.parallel = 1;
      }
      return webpackConfig;
    },
  },
};
module.exports = config;
