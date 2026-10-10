import { useState } from "react";
import { Button, Card, CardContent, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import { PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/opportunities/types";
import { emptyForm, type NewOpportunity } from "./use-opportunity-actions";

const BUDGET_PLACEHOLDER: Record<Platform, string> = {
  upwork: "ex. $500 fixed, ou $25–40/hr",
  codeur: "ex. 500 à 1 000 €",
  malt: "ex. 1 500 €, ou TJM 350 €",
  comeup: "ex. 120 €",
  autre: "ex. 500 €",
};

export const DESCRIPTION = "Texte, lien et budget de l'annonce, pour toute plateforme : l'analyse et la proposition prennent une trentaine de secondes. Rien n'est envoyé.";

type Props = { platform: Platform; busy: boolean; onSubmit: (form: NewOpportunity) => Promise<boolean>; onCancel: () => void };

/** Champs de l'annonce collée ; la plateforme est pré-réglée sur l'onglet courant, et modifiable. */
function useNewOpportunity(platform: Platform) {
  const [form, setForm] = useState(() => emptyForm(platform));
  const fields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="new-platform">Plateforme</Label>
        <Select id="new-platform" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as Platform })}>
          {PLATFORMS.map((value) => (
            <option key={value} value={value}>
              {PLATFORM_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="new-url">URL de l&apos;annonce</Label>
        <Input id="new-url" value={form.url} placeholder="https://…" onChange={(event) => setForm({ ...form, url: event.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="new-title">Titre (facultatif)</Label>
        <Input id="new-title" value={form.title} placeholder="sinon, la première ligne de l'annonce" onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="new-body">Texte de l&apos;annonce</Label>
        <Textarea id="new-body" rows={8} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
      </div>
      <div>
        <Label htmlFor="new-budget">Budget</Label>
        <Input id="new-budget" value={form.budget} placeholder={BUDGET_PLACEHOLDER[form.platform]} onChange={(event) => setForm({ ...form, budget: event.target.value })} />
      </div>
      <div>
        <Label htmlFor="new-deadline">Date limite</Label>
        <Input id="new-deadline" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
      </div>
    </div>
  );
  return { form, fields, reset: () => setForm(emptyForm(platform)) };
}

function Actions({ busy, onCancel, onSubmit, cancelLabel }: { busy: boolean; onCancel: () => void; onSubmit: () => void; cancelLabel: string }) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button loading={busy} onClick={onSubmit}>
        Analyser et rédiger
      </Button>
    </>
  );
}

/** « Coller une annonce » en fenêtre (Codeur, ComeUp, Autres). */
export function PasteModal({ open, title, ...props }: Props & { open: boolean; title: string }) {
  const { form, fields, reset } = useNewOpportunity(props.platform);
  const submit = async () => {
    if (await props.onSubmit(form)) reset();
  };
  return (
    <Modal open={open} onClose={props.onCancel} title={title} description={DESCRIPTION} size="lg" footer={<Actions busy={props.busy} onCancel={props.onCancel} onSubmit={submit} cancelLabel="Annuler" />}>
      {fields}
    </Modal>
  );
}

/** « Coller une annonce » ouvert dans la page (Upwork : pas de flux, l'annonce se colle à la main). */
export function PasteInline(props: Props) {
  const { form, fields, reset } = useNewOpportunity(props.platform);
  return (
    <Card className="mb-4">
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="text-[14px] font-medium text-text">Coller une annonce</h2>
          <p className="text-[12px] text-muted">{DESCRIPTION}</p>
        </div>
        {fields}
        <div className="flex justify-end gap-2">
          <Actions busy={props.busy} onCancel={props.onCancel} cancelLabel="Replier" onSubmit={async () => (await props.onSubmit(form)) && reset()} />
        </div>
      </CardContent>
    </Card>
  );
}
