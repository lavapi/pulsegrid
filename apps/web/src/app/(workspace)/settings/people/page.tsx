import type { Person } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { AddPersonForm } from '@/components/team/add-person-form';
import { PeopleList } from '@/components/team/people-list';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function PeoplePage() {
  const user = await getCurrentUser();
  if (!user.isOwner) {
    redirect('/');
  }
  const people = await apiGet<Person[]>('/people');
  return (
    <>
      <PageHeader
        title="People"
        description="Everyone who can sign in, across all projects. Add people here, then assign them under Members in each project."
      />
      <AddPersonForm />
      <PeopleList people={people} currentAccountEmail={user.email} />
    </>
  );
}
