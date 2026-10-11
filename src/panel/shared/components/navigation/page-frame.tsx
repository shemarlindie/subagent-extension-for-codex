import { type ReactNode, useLayoutEffect, useRef } from "react";

type PageFrameProps = {
  title: string;
  headingId: string;
  back?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

/** Full-width page structure with an accessible arrival heading. */
export function PageFrame({
  title,
  headingId,
  back,
  actions,
  children,
}: PageFrameProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="page-frame" aria-labelledby={headingId}>
      <div className="page-frame-heading">
        {back}
        <h1 id={headingId} ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {actions}
      </div>
      <div className="page-frame-content">{children}</div>
    </section>
  );
}
