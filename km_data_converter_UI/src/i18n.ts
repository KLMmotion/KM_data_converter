export const messages = {
  en: {
    brand: "KernelMind Data Converter",
    electronMissing: "Electron bridge is unavailable. Run the app with npm.cmd run dev.",
    language: "Language"
  },
  zh: {
    brand: "KernelMind Data Converter",
    electronMissing: "Electron 桥接不可用，请通过 npm.cmd run dev 启动。",
    language: "语言"
  }
} as const;

export type TranslationKey = keyof typeof messages.en;

export function createTranslator(language: Language) {
  return (key: TranslationKey) => messages[language][key];
}
