import { redirect } from "next/navigation";

/** /reglages → première section. */
export default function ReglagesIndex() {
  redirect("/reglages/donnees");
}
