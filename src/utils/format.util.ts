export function formatString(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in replacements ? replacements[key] : match))
}
