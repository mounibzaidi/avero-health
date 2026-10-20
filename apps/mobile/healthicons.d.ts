// Health Icons, one file per icon: the package's "exports" list only its whole sets, so the single files are declared
// here (the bundler resolves them as files). Each is a react-native-svg component.
declare module "healthicons-react-native/dist/outline/*" {
  const Icon: import("react").ComponentType<import("react-native-svg").SvgProps>;
  export default Icon;
}
