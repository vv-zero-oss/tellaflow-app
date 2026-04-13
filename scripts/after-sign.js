const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.warn(
      '[afterSign] Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, ' +
        'and APPLE_TEAM_ID environment variables must all be set.'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[afterSign] Notarizing ${appPath} …`);

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log('[afterSign] Notarization complete.');
};
