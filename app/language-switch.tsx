import type { UiLanguage } from "@/lib/ui-language";

type Props = {
  language: UiLanguage;
  label: string;
  onChange: (language: UiLanguage) => void;
};

export function LanguageSwitch({ language, label, onChange }: Props) {
  return (
    <div className="language-switch" role="group" aria-label={label}>
      <button type="button" className={language === "de" ? "is-active" : ""} aria-pressed={language === "de"} onClick={() => onChange("de")}>DE</button>
      <button type="button" className={language === "en" ? "is-active" : ""} aria-pressed={language === "en"} onClick={() => onChange("en")}>EN</button>
    </div>
  );
}
