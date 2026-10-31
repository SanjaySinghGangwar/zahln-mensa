#!/bin/zsh
# Full payment across two devices: the till rings up, the phone pays, the till shows Paid.
# Usage: e2e/run-payment.sh <till-device> <phone-device>   (adb serials, e.g. emulator-5554 emulator-5556)
# The phone must have no screen lock, so the app uses its own PIN (1234).
set -e
TILL=$1; PHONE=$2
MAESTRO=${MAESTRO:-maestro}
cd "$(dirname "$0")"

$MAESTRO --device "$TILL" test till-ring-up.yaml

# Read the order reference from the till screen.
adb -s "$TILL" shell am force-stop dev.mobile.maestro >/dev/null 2>&1 || true
adb -s "$TILL" shell am force-stop dev.mobile.maestro.test >/dev/null 2>&1 || true
sleep 2
adb -s "$TILL" shell uiautomator dump /sdcard/till.xml >/dev/null
ORDER=$(adb -s "$TILL" shell cat /sdcard/till.xml | grep -o 'ord_[A-Za-z0-9_-]*' | head -1)
echo "Order on the till: $ORDER"
[ -n "$ORDER" ]

$MAESTRO --device "$PHONE" test -e ORDER="$ORDER" pay-order.yaml
$MAESTRO --device "$TILL" test till-sees-paid.yaml
