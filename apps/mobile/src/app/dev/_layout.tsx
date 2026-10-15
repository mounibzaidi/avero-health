import { Redirect, Stack } from "expo-router";

/** Test screens (tokens, primitives): development builds only. */
export default function DevLayout() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
