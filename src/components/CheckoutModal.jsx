// ─────────────────────────────────────────────────────────────
// src/components/CheckoutModal.jsx
// Platform router for checkout.
//   iOS (Capacitor native)  -> IOSPaywall  (Apple StoreKit / RevenueCat)
//   Web / Android           -> PayModal    (Stripe — unchanged)
//
// This component is a DROP-IN replacement for PayModal at the import
// site in App.jsx. It accepts and forwards every prop PayModal uses,
// so all existing <PayModal .../> render sites keep working with no
// other changes. Apple requires that iOS never shows external (Stripe)
// payment UI, which this guarantees.
// ─────────────────────────────────────────────────────────────
import { Capacitor } from '@capacitor/core';
import StripePayModal from './PayModal';
import IOSPaywall from './IOSPaywall';

const IS_IOS = Capacitor.getPlatform() === 'ios';

export default function CheckoutModal(props) {
  if (IS_IOS) {
    // PayModal passes onSuccess() with no args in some sites and (planName)
    // in others — IOSPaywall calls onSuccess(planName); both are compatible.
    return (
      <IOSPaywall
        plan={props.plan}
        userId={props.userId}
        userEmail={props.userEmail}
        onClose={props.onClose}
        onSuccess={props.onSuccess}
      />
    );
  }
  // Web / Android: original Stripe modal, all props forwarded untouched.
  return <StripePayModal {...props} />;
}
