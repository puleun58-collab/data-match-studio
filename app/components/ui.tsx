import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react';

type ContainerProps = HTMLAttributes<HTMLDivElement>;

export function Container({ className = '', ...props }: ContainerProps) {
  return <div className={`container ${className}`.trim()} {...props} />;
}

type SectionProps = HTMLAttributes<HTMLElement> & {
  tone?: 'plain' | 'surface' | 'muted';
};

export function Section({ className = '', tone = 'plain', ...props }: SectionProps) {
  return <section className={`section section--${tone} ${className}`.trim()} {...props} />;
}

type HeadingProps = {
  level?: 1 | 2 | 3;
  children: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function Heading({ level = 2, children, description, className = '' }: HeadingProps) {
  const Tag = `h${level}` as const;
  return (
    <div className={`heading-group ${className}`.trim()}>
      <Tag>{children}</Tag>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
};

export function Button({ className = '', variant = 'secondary', type = 'button', ...props }: ButtonProps) {
  return <button className={`button button--${variant} ${className}`.trim()} type={type} {...props} />;
}

export function Form({ className = '', ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return <form className={`form ${className}`.trim()} {...props} />;
}

type FieldProps = {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Field({ label, htmlFor, hint, error, children, className = '' }: FieldProps) {
  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`.trim()}>
      <label htmlFor={htmlFor}>{label}</label>
      {hint ? <span className="field__hint">{hint}</span> : null}
      {children}
      {error ? <span className="field__error" role="alert">{error}</span> : null}
    </div>
  );
}

type StateMessageProps = {
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  action?: ReactNode;
  role?: 'status' | 'alert';
};

export function StateMessage({ title, children, tone = 'neutral', action, role = 'status' }: StateMessageProps) {
  return (
    <div className={`state-message state-message--${tone}`} role={role}>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      {action ? <div className="state-message__action">{action}</div> : null}
    </div>
  );
}
