#!/bin/bash
# Saha Navigasyon — Release APK Build
#
# Kullanım:
#   bash scripts/build-apk.sh "storepass" "keypass"
#
# Çıktı:
#   android/app/build/outputs/apk/release/app-release.apk
#   public/apk/saha-latest.apk (CF Pages public dağıtımı için)

set -e

STORE_PASS="${1:-}"
KEY_PASS="${2:-}"

if [ -z "$STORE_PASS" ] || [ -z "$KEY_PASS" ]; then
  echo "HATA: storepass + keypass parametreleri zorunlu."
  exit 1
fi

if [ ! -f "android/app/saha-release.keystore" ]; then
  echo "HATA: Keystore yok. Önce: bash scripts/generate-keystore.sh"
  exit 2
fi

echo "1/4 Web build (vite)…"
npm run build

echo "2/4 Capacitor sync…"
npx cap sync android

echo "3/4 Gradle release build…"
cd android
KEYSTORE_PASS="$STORE_PASS" KEY_PASS="$KEY_PASS" ./gradlew assembleRelease
cd ..

APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_SRC" ]; then
  echo "HATA: APK üretilemedi"
  exit 3
fi

echo "4/4 APK public/apk'a kopyala…"
mkdir -p public/apk
cp "$APK_SRC" "public/apk/saha-latest.apk"

# version.json + sha256
VERSION=$(node -e "console.log(require('./package.json').version)")
SHA=$(sha256sum public/apk/saha-latest.apk | awk '{print $1}')
cat > public/apk/version.json <<EOF
{
  "version": "$VERSION",
  "url": "/apk/saha-latest.apk",
  "sha256": "$SHA",
  "released_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ""
echo "✓ APK hazır: public/apk/saha-latest.apk"
echo "  Version: $VERSION"
echo "  SHA256:  $SHA"
echo ""
echo "Deploy: 'git add public/apk/ && git commit -m \"chore: APK v$VERSION\" && git push'"
echo "URL:    https://saha.parladisdeposu.com/apk/saha-latest.apk"
