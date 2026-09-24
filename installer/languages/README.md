# Vendored installer language files

`ChineseSimplified.isl` is the user-contributed Inno Setup 6 Simplified Chinese
translation, taken from
[kira-96/Inno-Setup-Chinese-Simplified-Translation](https://github.com/kira-96/Inno-Setup-Chinese-Simplified-Translation)
(the upstream project recommended by Inno Setup's own
[unofficial translations page](https://jrsoftware.org/files/istrans/)). Inno
Setup does not bundle it in its `Languages` folder, so the installer script
loads it from here.

- Encoding: UTF-8, as the file's own header requires.
- Maintainer and contact are recorded in the file header; do not strip the
  attribution comment block when updating.
- Update command:

  ```sh
  curl -sSL -o installer/languages/ChineseSimplified.isl \
    https://raw.githubusercontent.com/kira-96/Inno-Setup-Chinese-Simplified-Translation/master/ChineseSimplified.isl
  ```

The file only supplies translated strings for the setup wizard; the installer's
own copy (shortcut names, messages in `[Code]`) lives in
`installer/DeepSeekHarness.iss` and is written in both languages there.
