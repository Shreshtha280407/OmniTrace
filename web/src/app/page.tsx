import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { Navbar } from "@/components/landing/Navbar";
import {
  AtomicProofSection,
  ClosingCTA,
  ConnectedContextSection,
  EvidenceOnlySection,
} from "@/components/landing/ProofSections";
import { Walkthrough } from "@/components/landing/Walkthrough";
import { DemoBadge } from "@/components/ui/DemoBadge";

/** Marketing landing page. */
export default function LandingPage() {
  return (
    <>
      <DemoBadge variant="banner" />
      <Navbar />
      <main id="main">
        <Hero />
        <Walkthrough />
        <AtomicProofSection />
        <ConnectedContextSection />
        <EvidenceOnlySection />
        <ClosingCTA />
      </main>
      <Footer />
    </>
  );
}
