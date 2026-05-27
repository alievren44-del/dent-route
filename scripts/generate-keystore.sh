#!/bin/bash
# Saha Navigasyon — Release Keystore Oluşturucu (tek seferlik)
#
# Kullanım:
#   bash scripts/generate-keystore.sh "secure-password" "key-password"
#
# UYARI: KEYSTORE PAROLASINI GÜVENLİ BİR YERDE SAKLA (LastPass/1Password).
# Kayıpsa: APK güncellemesi aynı imzayla yapılamaz, yeniden APK gerekir.

set -e

STORE_PASS="${1:-}"
KEY_PASS="${2:-}"

if [ -z "$STORE_PASS" ] || [ -z "$KEY_PASS" ]; then
  echo "HATA: storepass + keypass parametreleri zorunlu."
  echo "Kullanım: bash scripts/generate-keystore.sh <storepass> <keypass>"
  exit 1
fi

KEYSTORE_PATH="android/app/saha-release.keystore"
mkdir -p "$(dirname "$KEYSTORE_PATH")"

if [ -f "$KEYSTORE_PATH" ]; then
  echo "UYARI: $KEYSTORE_PATH zaten var. Silmeden tekrar oluşturma!"
  exit 2
fi

keytool -genkey -v \
  -keystore "$KEYSTORE_PATH" \
  -alias saha-release \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$STORE_PASS" \
  -keypass "$KEY_PASS" \
  -dname "CN=Parla Saha, OU=Mobile, O=Parla Dis Deposu, L=Ankara, S=Ankara, C=TR"

echo ""
echo "✓ Keystore üretildi: $KEYSTORE_PATH"
echo ""
echo "ŞIMDI YAP:"
echo "  1. Parolayı LastPass/1Password'a kaydet"
echo "  2. $KEYSTORE_PATH dosyasının USB yedeğini al"
echo "  3. .gitignore'da olduğunu doğrula"
