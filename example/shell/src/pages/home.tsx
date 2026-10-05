import { Link } from "@satilian/router";
import P from "host1/P";
import Span from "host2/Span";
import Section from "host2/Section";
import { Suspense } from "react";

export const HomePage = () => {
  return (
    <div>
      <h1>Home Page</h1>

      <Suspense>
        <Section>
          <P text="Welcome to the home page." />

          <Link to="/about">About Page</Link>

          <Span />
        </Section>
      </Suspense>
    </div>
  );
};
