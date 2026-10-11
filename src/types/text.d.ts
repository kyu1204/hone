// Bun text imports (`with { type: "text" }`) for extensions bun-types does not declare.
declare module "*.md" {
  const text: string;
  export default text;
}
