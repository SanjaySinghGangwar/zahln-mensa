// Signs release builds with the Zahln upload key when the build machine has it.
// The key and its passwords live outside the repository, in
// ~/.gradle/gradle.properties (ZAHLN_UPLOAD_*). Without them the release build
// falls back to the debug key, which is fine for a test APK.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let gradle = c.modResults.contents;
    if (gradle.includes('ZAHLN_UPLOAD_STORE_FILE')) return c;
    gradle = gradle.replace(
      /signingConfigs \{/,
      `signingConfigs {
        release {
            if (project.hasProperty('ZAHLN_UPLOAD_STORE_FILE')) {
                storeFile file(ZAHLN_UPLOAD_STORE_FILE)
                storePassword ZAHLN_UPLOAD_STORE_PASSWORD
                keyAlias ZAHLN_UPLOAD_KEY_ALIAS
                keyPassword ZAHLN_UPLOAD_KEY_PASSWORD
            }
        }`,
    );
    gradle = gradle.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('ZAHLN_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );
    c.modResults.contents = gradle;
    return c;
  });
};
