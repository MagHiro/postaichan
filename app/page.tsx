import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Bara & Burn",
  description: "Sate taichan panas, sambal fresh, siap bikin nagih.",
};

export default function Home() {
  return <LandingPage />;
}
