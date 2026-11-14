jest.mock("react-native-reanimated", () =>
  require("./jest.reanimatedMock"),
);

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
