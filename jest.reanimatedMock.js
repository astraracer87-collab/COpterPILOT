const React = require("react");
const {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} = require("react-native");

const identity = (value) => value;

function useSharedValue(initialValue) {
  return { value: initialValue };
}

function useAnimatedStyle(updater) {
  try {
    return updater();
  } catch {
    return {};
  }
}

function createAnimatedComponent(Component) {
  return React.forwardRef((props, ref) =>
    React.createElement(Component, { ...props, ref }),
  );
}

function animationBuilder() {
  const builder = {
    delay: () => builder,
    duration: () => builder,
    easing: () => builder,
    springify: () => builder,
    withCallback: () => builder,
    withInitialValues: () => builder,
  };
  return builder;
}

const Animated = {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  createAnimatedComponent,
};

module.exports = {
  __esModule: true,
  default: Animated,
  FadeIn: animationBuilder(),
  FadeInDown: animationBuilder(),
  ZoomIn: animationBuilder(),
  useAnimatedStyle,
  useSharedValue,
  withSpring: (value, _config, callback) => {
    callback?.(true);
    return value;
  },
  withTiming: (value, _config, callback) => {
    callback?.(true);
    return value;
  },
};