-- ===========================================================================
-- Profil métier d'un prospect, lu sur son site
--
-- Le stratège choisissait le pain à partir du code NAF : BRIOL DIFFUSION
-- (NAF 46.73A, « négoce ») devenait un problème d'expéditions alors que c'est
-- un menuisier fourniture + pose, avec trois showrooms et douze commerciaux —
-- son vrai sujet, ce sont les devis. `business_profile` garde ce qu'on lit
-- sur leur site (ce qu'ils vendent, à qui, comment arrivent les demandes,
-- implantations, services) : le stratège choisit le pain DEPUIS ce profil.
--
-- Migration additive et idempotente : deux colonnes nullables.
-- ===========================================================================

alter table public.prospects add column if not exists business_profile jsonb;
alter table public.prospects add column if not exists business_profile_at timestamptz;
