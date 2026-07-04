import { LoginForm } from "@/components/login-form";
import { PageHeader } from "@/components/ui";

export default async function LoginPage(props: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await props.searchParams;

  return (
    <div className="mx-auto max-w-sm space-y-8">
      <div className="rise">
        <PageHeader eyebrow="Sign in" title="Enter your email" />
      </div>
      <div className="rise rise-1">
        <LoginForm next={next ?? "/groups"} />
      </div>
    </div>
  );
}
