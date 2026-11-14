module.exports = {
  preset: "jest-expo",
  testTimeout: 20000,
  testMatch: [
    "**/components/**/__tests__/**/*.test.tsx",
    "**/screens/**/__tests__/**/*.test.tsx",
    "**/navigation/**/__tests__/**/*.test.tsx",
  ],
  modulePathIgnorePatterns: ["<rootDir>/.cache/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/client/$1",
    "^@shared/(.*)$": "<rootDir>/shared/$1",
    "^@client/(.*)$": "<rootDir>/client/$1",
    "^expo-modules-core$": "<rootDir>/node_modules/expo-modules-core",
  },
};
